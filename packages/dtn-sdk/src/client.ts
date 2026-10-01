/** TypeScript client for a local DTN relay daemon (localhost only). */

export interface SendResult {
  ok: boolean;
  bundle?: {
    id: string;
    src: string;
    dst: string;
    payload: string;
    createdAt: number;
    ttlMs: number;
  };
  error?: string;
}

export interface DeliveredMessage {
  id: string;
  src: string;
  dst: string;
  payload: string;
  deliveredAt: number;
  hops: Array<{ from: string; to: string; at: number }>;
}

export interface RelayStatus {
  nodeId: string;
  role: string;
  port: number;
  peerUrl: string;
  uptimeMs: number;
  store: { bundles: number; custody: number; index: number; inbox: number };
  dataDir: string;
  contact: {
    peer: string;
    open: boolean;
    delayMs: number;
    nextChangeAt: number;
    phase: string;
  };
  recentEvents: Array<{ t: number; event: string; msg: string }>;
}

export interface DtnClientOptions {
  /** Base URL of local relay, e.g. http://127.0.0.1:3101 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class DtnClient {
  readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: DtnClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchFn = opts.fetchImpl ?? fetch;
  }

  private api(path: string): string {
    return `${this.baseUrl}/api${path}`;
  }

  async health(): Promise<{ ok: boolean }> {
    const res = await this.fetchFn(this.api('/health'));
    return res.json() as Promise<{ ok: boolean }>;
  }

  async status(): Promise<RelayStatus> {
    const res = await this.fetchFn(this.api('/status'));
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    return res.json() as Promise<RelayStatus>;
  }

  async send(dst: string, payload: string, ttlMs?: number): Promise<SendResult> {
    const res = await this.fetchFn(this.api('/send'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dst, payload, ttlMs }),
    });
    return res.json() as Promise<SendResult>;
  }

  async recv(clear = true): Promise<DeliveredMessage[]> {
    const q = clear ? '' : '?clear=0';
    const res = await this.fetchFn(this.api(`/recv${q}`));
    const body = (await res.json()) as { messages: DeliveredMessage[] };
    return body.messages ?? [];
  }

  async inbox(): Promise<DeliveredMessage[]> {
    const res = await this.fetchFn(this.api('/inbox'));
    const body = (await res.json()) as { messages: DeliveredMessage[] };
    return body.messages ?? [];
  }

  /**
   * Poll until at least one delivery or timeout.
   * Returns delivered messages (already cleared from relay inbox).
   */
  async subscribeDelivery(opts?: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (status: RelayStatus) => void;
  }): Promise<DeliveredMessage[]> {
    const intervalMs = opts?.intervalMs ?? 500;
    const timeoutMs = opts?.timeoutMs ?? 60000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (opts?.onTick) {
        try {
          opts.onTick(await this.status());
        } catch {
          /* ignore */
        }
      }
      const msgs = await this.recv(true);
      if (msgs.length > 0) return msgs;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return [];
  }
}

/** Convenience: Earth relay default. */
export function earthClient(): DtnClient {
  return new DtnClient({ baseUrl: process.env.DTN_RELAY_URL ?? 'http://127.0.0.1:3101' });
}

/** Convenience: Mars relay default. */
export function marsClient(): DtnClient {
  return new DtnClient({ baseUrl: process.env.DTN_RELAY_URL ?? 'http://127.0.0.1:3102' });
}
