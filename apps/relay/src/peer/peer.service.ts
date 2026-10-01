import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { RelayBundle } from '../bundle/bundle.types';
import { toWireBundle } from '../bp/wire';
import { RELAY_CONFIG } from '../relay.tokens';
import { peerUrlFor, type RelayRuntimeConfig } from '../config';
import {
  GraphService,
  type JoinRemote,
  type JoinResponse,
} from '../graph/graph.service';
import type { GraphSummary } from '../graph/graph.types';

export interface PeerIngestResult {
  accepted: boolean;
  delivered: boolean;
  duplicate?: boolean;
  event: string;
  msg: string;
}

export interface PeerAckEvent {
  t: number;
  node: string;
  kind: string;
  msg: string;
}

@Injectable()
export class PeerService {
  private readonly log = new Logger(PeerService.name);

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Optional() @Inject(GraphService) private readonly graph?: GraphService,
  ) {}

  /**
   * Ask a bootstrap to record this node, then store the bootstrap as a direct
   * peer and merge its summary. Join contact is cyclic 30s, open the whole period.
   */
  async postJoin(
    bootstrapUrl: string,
    body: JoinRemote,
  ): Promise<JoinResponse | { ok: false; error: string }> {
    const root = bootstrapUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${root}/api/peer/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      const json = (await res.json()) as JoinResponse | { ok?: boolean; error?: string };
      if (!res.ok || json.ok !== true || !('summary' in json)) {
        const error = 'error' in json && typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
        return { ok: false, error };
      }
      this.graph?.acceptBootstrap(root, json);
      return json;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`join failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /** Push a contact-graph summary to one direct peer. Never throws. */
  async postGraph(peerUrl: string, summary: GraphSummary): Promise<boolean> {
    const root = peerUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${root}/api/peer/graph`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err: unknown) {
      this.log.warn(`graph gossip failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Join-recorded URL when graphMode, otherwise the static plan map. */
  urlFor(id: string): string {
    return peerUrlFor(this.cfg, id, this.graph);
  }

  /** Push bundle to a specific next-hop relay over HTTP (CLA-ish). */
  async forwardTo(
    url: string,
    bundle: RelayBundle
  ): Promise<{
    ok: boolean;
    body?: PeerIngestResult;
    error?: string;
    wireBase64?: string;
    /** Encode failed. Caller must not treat this as a window retry. */
    permanentEncode?: boolean;
  }> {
    let wire: Buffer;
    try {
      wire = bundle.wire ? Buffer.from(bundle.wire, 'base64') : toWireBundle(bundle, this.cfg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`encode failed: ${msg}`);
      return { ok: false, error: msg, permanentEncode: true };
    }
    const wireBase64 = wire.toString('base64');
    try {
      const res = await fetch(`${url}/api/peer/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/cbor',
          'x-dtn-from': this.cfg.nodeId,
          'x-dtn-bundle-id': bundle.id,
        },
        body: wire,
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json()) as PeerIngestResult;
      if (!res.ok) return { ok: false, body, error: `HTTP ${res.status}`, wireBase64 };
      return { ok: true, body, wireBase64 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`forward failed: ${msg}`);
      return { ok: false, error: msg, wireBase64 };
    }
  }

  /** True only when the ack HTTP response is ok. Never throws. */
  async sendAck(toUrl: string, bundleId: string, events: PeerAckEvent[] = []): Promise<boolean> {
    try {
      const res = await fetch(`${toUrl}/api/peer/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bundleId, from: this.cfg.nodeId, events }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err: unknown) {
      this.log.warn(`ack failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
