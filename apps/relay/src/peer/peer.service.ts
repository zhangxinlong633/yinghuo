import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RelayBundle } from '../bundle/bundle.types';
import { toWireBundle } from '../bp/wire';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';

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

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {}

  /** Push bundle to a specific next-hop relay over HTTP (CLA-ish). */
  async forwardTo(
    url: string,
    bundle: RelayBundle
  ): Promise<{ ok: boolean; body?: PeerIngestResult; error?: string; wireBase64?: string }> {
    let wire: Buffer;
    try {
      wire = toWireBundle(bundle, this.cfg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`encode failed: ${msg}`);
      return { ok: false, error: msg };
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
