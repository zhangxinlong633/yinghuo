#!/usr/bin/env node
/**
 * Remote HTTP tool gateway (Bearer token). Not full MCP SSE.
 * Env: YINGHUO_MCP_TOKEN (required), YINGHUO_MCP_HTTP_PORT (default 3110),
 *      YINGHUO_MCP_MODE=read|write, YINGHUO_MCP_AUDIT, DTN_RELAY_URL
 */
import * as http from 'http';
import { RelayHttpClient } from './relay-client.js';
import { resolveRelayUrl } from './relay-url.js';
import { formatAuditLine } from './audit.js';
import { assertToolAllowed, bearerOk, mcpMode, requireHttpToken } from './tool-policy.js';
import * as fs from 'fs';

const TOOLS: Record<string, (client: RelayHttpClient, args: Record<string, unknown>) => Promise<unknown>> = {
  yinghuo_status: (c) => c.getJson('/api/status'),
  yinghuo_contacts: (c) => c.getJson('/api/contacts'),
  yinghuo_plan: (c) => c.getJson('/api/plan'),
  yinghuo_plan_reload: (c, args) => c.postJson('/api/plan/reload', args.body ?? {}),
  yinghuo_graph: (c) => c.getJson('/api/graph'),
  yinghuo_graph_route: (c, args) => c.getJson('/api/graph/route', { dst: String(args.dst ?? '') }),
  yinghuo_send: (c, args) =>
    c.postJson('/api/send', {
      dst: args.dst,
      payload: args.payload,
      ...(typeof args.ttlMs === 'number' ? { ttlMs: args.ttlMs } : {}),
    }),
  yinghuo_inbox: (c, args) =>
    args.clear === true ? c.getJson('/api/recv', { clear: '1' }) : c.getJson('/api/inbox'),
};

function audit(ev: { t: number; tool: string; ok: boolean; mode: string; error?: string }): void {
  const path = process.env.YINGHUO_MCP_AUDIT;
  if (!path) return;
  try {
    fs.appendFileSync(path, `${formatAuditLine(ev)}\n`);
  } catch {
    /* ignore */
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (!requireHttpToken()) {
    console.error('YINGHUO_MCP_TOKEN required for HTTP MCP');
    process.exit(1);
  }
  const baseUrl = resolveRelayUrl();
  const client = new RelayHttpClient({ baseUrl });
  const port = Number(process.env.YINGHUO_MCP_HTTP_PORT ?? 3110);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: mcpMode(), relay: baseUrl }));
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/tools/')) {
      if (!bearerOk(req.headers.authorization)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      const name = decodeURIComponent(url.pathname.slice('/tools/'.length));
      const impl = TOOLS[name];
      if (!impl) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `unknown tool ${name}` }));
        return;
      }
      let args: Record<string, unknown> = {};
      try {
        args = await readJson(req);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        return;
      }
      try {
        assertToolAllowed(name, args);
        const data = await impl(client, args);
        audit({ t: Date.now(), tool: name, ok: true, mode: mcpMode() });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data }));
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        audit({ t: Date.now(), tool: name, ok: false, mode: mcpMode(), error });
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '0.0.0.0', () => {
    console.error(`yinghuo-mcp-http :${port} relay=${baseUrl} mode=${mcpMode()}`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
