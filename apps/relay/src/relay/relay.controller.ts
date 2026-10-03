import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { decodeBundle, type BpDecoded } from '../bp/bp-codec';
import { bundleFromDecoded, WireEncodeError } from '../bp/wire';
import { BundleService } from '../bundle/bundle.service';
import type { BundleEvent } from '../bundle/bundle-machine';
import { toBusinessInboxMessage, toBusinessSendFields } from '../bp/business-view';
import type { RelayBundle } from '../bundle/bundle.types';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';
import { GraphService, type JoinRemote } from '../graph/graph.service';
import type { GraphSummary } from '../graph/graph.types';
import { PeerService } from '../peer/peer.service';
import { ContactPlanReloadService } from '../contact/contact-plan-reload.service';
import { missionNow, describeMissionClock } from '../clock/mission-clock';
import { joinTokenOk } from '../trust/join-token';
import { bpsecIngestOk } from '../bpsec/bpsec';

function mediaType(contentType?: string): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** Transit hash is the header the sender declared. Never recompute from payload bytes. */
function stampPayloadSha256(
  bundle: RelayBundle | undefined,
  header?: string,
): RelayBundle | undefined {
  if (!bundle) return bundle;
  const hex = header?.trim().toLowerCase();
  if (!hex) return bundle;
  return { ...bundle, payloadSha256: hex };
}

async function readRawBody(req: Request): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

@Controller()
export class RelayController {
  constructor(
    @Inject(BundleService) private readonly bundles: BundleService,
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Optional() @Inject(GraphService) private readonly graph?: GraphService,
    @Optional() @Inject(PeerService) private readonly peer?: PeerService,
    @Optional() @Inject(ContactPlanReloadService) private readonly plans?: ContactPlanReloadService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'dtn-relay' };
  }

  @Get('status')
  async status() {
    return this.bundles.status();
  }

  @Get('clock')
  clock() {
    return describeMissionClock();
  }

  @Get('contacts')
  contactsState() {
    return {
      ...this.contacts.snapshot(),
      plan: this.plans?.getStatus() ?? this.cfg.planStatus,
    };
  }

  @Get('plan')
  planStatus() {
    return this.plans?.getStatus() ?? this.cfg.planStatus;
  }

  /**
   * Hot-reload contact plan from disk, or apply JSON body without writing disk.
   * Failed validation keeps the previous effective plan.
   */
  @Post('plan/reload')
  reloadPlan(@Body() body: unknown) {
    const service = this.plans;
    if (!service) {
      throw new ServiceUnavailableException({ ok: false, error: 'plan reload unavailable' });
    }
    const hasBody =
      body != null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body as object).length > 0;
    const result = hasBody ? service.reloadFromBody(body) : service.reloadFromDisk('http');
    if (!result.ok) {
      throw new BadRequestException({
        ok: false,
        errors: result.errors,
        plan: service.getStatus(),
      });
    }
    return { ok: true as const, version: result.version, source: result.source, plan: service.getStatus() };
  }

  @Get('graph')
  graphSnapshot() {
    return this.requireGraph().snapshot();
  }

  /** Read-only next-hop trial. Same decide() the forwarder uses. */
  @Get('graph/route')
  graphRoute(@Query('dst') dst?: string) {
    if (!dst) {
      throw new BadRequestException({ ok: false, error: 'dst required' });
    }
    return this.requireGraph().decide(dst, missionNow());
  }

  /**
   * Join another bootstrap after start (bridge / multi-island).
   * Same body shape as startup BOOTSTRAP_URL join.
   */
  @Post('graph/join')
  async graphJoin(@Body() body: { url?: string }, @Headers('x-yinghuo-join-token') joinTok?: string) {
    this.assertJoinToken(joinTok);
    const url = body?.url?.trim();
    if (!url) {
      throw new BadRequestException({ ok: false, error: 'url required' });
    }
    this.requireGraph();
    const peer = this.peer;
    if (!peer) {
      throw new ServiceUnavailableException({ ok: false, error: 'peer service unavailable' });
    }
    const result = await peer.postJoin(url, {
      nodeId: this.cfg.nodeId,
      eid: this.cfg.eid,
      port: this.cfg.port,
      x: this.cfg.x,
      y: this.cfg.y,
      peerUrl: this.cfg.peerUrl || `http://127.0.0.1:${this.cfg.port}`,
      role: this.cfg.role,
    });
    if (result.ok !== true) {
      throw new BadRequestException({
        ok: false,
        error: 'error' in result ? result.error : 'join failed',
      });
    }
    return { ok: true as const, summary: result.summary };
  }

  /**
   * Bootstrap side of join. Records the caller as a direct peer with an
   * always-open cyclic contact (period 30s, openDuration 30s) and returns
   * this node's summary. The caller records the reverse edge via postJoin.
   */
  @Post('peer/join')
  peerJoin(@Body() body: JoinRemote, @Headers('x-yinghuo-join-token') joinTok?: string) {
    this.assertJoinToken(joinTok);
    if (
      !body?.nodeId ||
      !body.eid ||
      !body.peerUrl ||
      typeof body.port !== 'number' ||
      typeof body.x !== 'number' ||
      typeof body.y !== 'number'
    ) {
      throw new BadRequestException({
        ok: false,
        error: 'nodeId, eid, port, x, y, peerUrl required',
      });
    }
    const graph = this.requireGraph();
    graph.applyJoin(body);
    return graph.buildJoinResponse();
  }

  @Post('peer/graph')
  peerGraph(@Body() body: GraphSummary) {
    if (!body || typeof body.from !== 'string' || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      throw new BadRequestException({ ok: false, error: 'GraphSummary required' });
    }
    this.requireGraph().ingestSummary(body);
    return { ok: true as const };
  }

  @Get('bundles')
  async listBundles() {
    return { ok: true, bundles: await this.bundles.listBundles() };
  }

  @Get('bundles/:id')
  async bundle(@Param('id') id: string) {
    const bundle = await this.bundles.getBundle(id);
    if (!bundle) return { ok: false, error: 'not found' };
    return { ok: true, bundle };
  }

  @Post('send')
  async send(
    @Body() body: { dst: string; payload: string; ttlMs?: number }
  ) {
    if (!body?.dst || body.payload == null) {
      return { ok: false, error: 'dst and payload required' };
    }
    try {
      const bundle = await this.bundles.send(body.dst, String(body.payload), body.ttlMs);
      return { ok: true, ...toBusinessSendFields(bundle) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('role=relay') || err instanceof WireEncodeError) {
        return { ok: false, error: message };
      }
      throw err;
    }
  }

  @Get('recv')
  recv(@Query('clear') clear?: string) {
    const doClear = clear !== '0' && clear !== 'false';
    const messages = this.bundles.recv(doClear).map(toBusinessInboxMessage);
    return { ok: true, messages };
  }

  @Get('inbox')
  inbox() {
    return { ok: true, messages: this.bundles.peekInbox().map(toBusinessInboxMessage) };
  }

  /**
   * Peer CLA: only accept when contact window is open (schedule-aware store-and-forward).
   * Header x-dtn-bypass-contact is ignored in normal mode (educational lock).
   */
  @Post('peer/ingest')
  async peerIngest(
    @Req() req: Request,
    @Headers('content-type') contentType?: string,
    @Headers('x-dtn-from') fromHeader?: string,
    @Headers('x-dtn-bundle-id') bundleIdHeader?: string,
    @Headers('x-dtn-force') force?: string,
    @Headers('x-dtn-bpsec') bpsecHeader?: string,
    @Headers('x-dtn-replica') replicaHeader?: string,
    @Headers('x-dtn-payload-sha256') payloadSha256Header?: string,
  ) {
    if (!bpsecIngestOk(bpsecHeader)) {
      throw new BadRequestException({
        accepted: false,
        delivered: false,
        event: 'BPSEC_REQUIRED',
        msg: 'DTN_BPSEC=1 requires x-dtn-bpsec: integrity (demo marker, not CCSDS BPSec)',
      });
    }
    const replica = replicaHeader === '1';
    const type = mediaType(contentType);
    if (type === 'application/json') {
      if (process.env.DTN_ALLOW_JSON_INGEST !== '1') {
        throw new BadRequestException({
          accepted: false,
          delivered: false,
          event: 'DECODE_ERROR',
          msg: 'JSON ingest disabled',
        });
      }
      const body = req.body as { bundle?: RelayBundle; from?: string };
      return this.acceptPeerBundle(
        stampPayloadSha256(body?.bundle, payloadSha256Header),
        body?.from,
        replica ? '1' : force,
        replica,
      );
    }

    if (type !== 'application/cbor') {
      throw new BadRequestException({
        accepted: false,
        delivered: false,
        event: 'DECODE_ERROR',
        msg: `unsupported content-type ${type || '(missing)'}`,
      });
    }

    if (!fromHeader) {
      return { accepted: false, delivered: false, event: 'ERROR', msg: 'bundle+from required' };
    }
    if (force !== '1' && !replica && !this.contacts.isOpenTo(fromHeader)) {
      throw new ServiceUnavailableException({
        accepted: false,
        delivered: false,
        event: 'CONTACT_CLOSED',
        msg: 'contact window closed — peer should store-and-forward later',
      });
    }

    const raw = await readRawBody(req);
    let decoded: BpDecoded;
    try {
      decoded = decodeBundle(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        accepted: false,
        delivered: false,
        event: 'DECODE_ERROR',
        msg,
      });
    }

    const mapped = bundleFromDecoded(decoded, this.cfg, bundleIdHeader ?? '');
    if (!mapped.ok) {
      this.bundles.recordOps('REJECT', `unknown eid ${mapped.eid}`);
      throw new BadRequestException({
        accepted: false,
        delivered: false,
        event: 'UNKNOWN_EID',
        msg: `unknown eid ${mapped.eid}`,
      });
    }

    const bundle = stampPayloadSha256(
      { ...mapped.bundle, wire: raw.toString('base64') },
      payloadSha256Header,
    );
    return this.acceptPeerBundle(bundle, fromHeader, '1', replica);
  }

  private acceptPeerBundle(
    bundle: RelayBundle | undefined,
    from: string | undefined,
    force?: string,
    replica = false,
  ) {
    if (!bundle || !from) {
      return { accepted: false, delivered: false, event: 'ERROR', msg: 'bundle+from required' };
    }
    if (force !== '1' && !this.ingestContactOpen(bundle, from)) {
      throw new ServiceUnavailableException({
        accepted: false,
        delivered: false,
        event: 'CONTACT_CLOSED',
        msg: 'contact window closed — peer should store-and-forward later',
      });
    }
    return this.bundles.ingestFromPeer(bundle, from, replica);
  }

  private requireGraph(): GraphService {
    if (!this.graph) {
      throw new ServiceUnavailableException({ ok: false, error: 'graph unavailable' });
    }
    return this.graph;
  }

  private assertJoinToken(header?: string): void {
    if (!joinTokenOk(header)) {
      throw new UnauthorizedException({ ok: false, error: 'join token required' });
    }
  }

  private ingestContactOpen(bundle: RelayBundle, from: string): boolean {
    const deliveringLocally = bundle.dst === this.cfg.nodeId;
    if (deliveringLocally) return this.contacts.isOpenTo(from);
    return this.contacts.isOpenTo(from);
  }

  @Post('peer/ack')
  async peerAck(@Body() body: { bundleId: string; from: string; events?: BundleEvent[] }) {
    if (!body?.bundleId || !body?.from) {
      return { ok: false };
    }
    await this.bundles.onAck(body.bundleId, body.from, body.events ?? []);
    return { ok: true };
  }
}
