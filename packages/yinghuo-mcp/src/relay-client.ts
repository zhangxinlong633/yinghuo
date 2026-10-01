export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    readonly url: string,
  ) {
    const snippet = bodyText.length > 400 ? `${bodyText.slice(0, 400)}…` : bodyText;
    super(`HTTP ${status} ${url}${snippet ? `: ${snippet}` : ''}`);
    this.name = 'RelayHttpError';
  }
}

export type RelayHttpClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Thin JSON HTTP client for Yinghuo relay /api/*.
 */
export class RelayHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RelayHttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getJson(path: string, query?: Record<string, string | undefined>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    return this.request(url, { method: 'GET' });
  }

  async postJson(path: string, body?: unknown): Promise<unknown> {
    const url = this.buildUrl(path);
    return this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    const u = new URL(`${this.baseUrl}${p}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`relay unreachable ${url}: ${msg}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new RelayHttpError(res.status, text, url);
    }
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

export function formatToolError(err: unknown): string {
  if (err instanceof RelayHttpError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
