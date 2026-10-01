import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { decodeBundle, type BpDecoded } from '../bp/bp-codec';
import { bundleFromDecoded } from '../bp/wire';
import { BundleService } from '../bundle/bundle.service';
import type { BundleEvent } from '../bundle/bundle-machine';
import { toBusinessInboxMessage, toBusinessSendFields } from '../bp/business-view';
import type { RelayBundle } from '../bundle/bundle.types';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';

function mediaType(contentType?: string): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
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
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'dtn-relay' };
  }

  @Get('status')
  async status() {
    return this.bundles.status();
  }

  @Get('contacts')
  contactsState() {
    return this.contacts.snapshot();
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
      if (message.includes('role=relay')) {
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
    @Headers('x-dtn-force') force?: string
  ) {
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
      return this.acceptPeerBundle(body?.bundle, body?.from, force);
    }

    if (type !== 'application/cbor') {
      throw new BadRequestException({
        accepted: false,
        delivered: false,
        event: 'DECODE_ERROR',
        msg: `unsupported content-type ${type || '(missing)'}`,
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

    const bundle: RelayBundle = { ...mapped.bundle, wire: raw.toString('base64') };
    return this.acceptPeerBundle(bundle, fromHeader, force);
  }

  private acceptPeerBundle(
    bundle: RelayBundle | undefined,
    from: string | undefined,
    force?: string
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
    return this.bundles.ingestFromPeer(bundle, from);
  }

  /**
   * Gate on the arrival contact (`from`), which is the sender's next hop.
   * Do not use the single first-contact `isOpen()`: when this node is the
   * destination, a different closed segment must not 503. A relay likewise
   * stores while its own outgoing hop is still closed.
   */
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
