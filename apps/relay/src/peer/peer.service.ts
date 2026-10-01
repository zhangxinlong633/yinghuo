import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RelayBundle } from '../bundle/bundle.types';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';

export interface PeerIngestResult {
  accepted: boolean;
  delivered: boolean;
  event: string;
  msg: string;
}

@Injectable()
export class PeerService {
  private readonly log = new Logger(PeerService.name);

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {}

  /** Push bundle to peer relay over HTTP (CLA-ish). */
  async forwardToPeer(bundle: RelayBundle): Promise<{ ok: boolean; body?: PeerIngestResult; error?: string }> {
    const url = `${this.cfg.peerUrl}/api/peer/ingest`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bundle, from: this.cfg.nodeId }),
      });
      const body = (await res.json()) as PeerIngestResult;
      if (!res.ok) {
        return { ok: false, body, error: `HTTP ${res.status}` };
      }
      return { ok: true, body };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`forward failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async sendAck(toUrl: string, bundleId: string): Promise<void> {
    try {
      await fetch(`${toUrl}/api/peer/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bundleId, from: this.cfg.nodeId }),
      });
    } catch (err: unknown) {
      this.log.warn(`ack failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
