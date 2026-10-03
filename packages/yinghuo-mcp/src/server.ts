import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatAuditLine } from './audit.js';
import { formatToolError, type RelayHttpClient } from './relay-client.js';
import { assertToolAllowed, mcpMode } from './tool-policy.js';
import * as fs from 'fs';

function textResult(data: unknown, isError = false) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }], isError };
}

function writeAudit(ev: { t: number; tool: string; ok: boolean; mode: string; error?: string }): void {
  const path = process.env.YINGHUO_MCP_AUDIT;
  if (!path) return;
  try {
    fs.appendFileSync(path, `${formatAuditLine(ev)}\n`);
  } catch {
    /* ignore audit IO */
  }
}

async function runTool(name: string, args: Record<string, unknown>, fn: () => Promise<unknown>) {
  try {
    assertToolAllowed(name, args);
    const data = await fn();
    writeAudit({ t: Date.now(), tool: name, ok: true, mode: mcpMode() });
    return textResult(data);
  } catch (err: unknown) {
    writeAudit({
      t: Date.now(),
      tool: name,
      ok: false,
      mode: mcpMode(),
      error: formatToolError(err),
    });
    return textResult(formatToolError(err), true);
  }
}

/**
 * Build MCP server with Yinghuo relay ops tools (v1 minimal set).
 */
export function createYinghuoServer(client: RelayHttpClient): McpServer {
  const server = new McpServer({
    name: 'yinghuo',
    version: '1.0.0',
  });

  server.registerTool(
    'yinghuo_status',
    {
      title: 'Relay status',
      description:
        'Read-only. GET /api/status — node role/capabilities, plan metadata, contact phase, store depths.',
      inputSchema: {},
    },
    async () => runTool('yinghuo_status', {}, () => client.getJson('/api/status')),
  );

  server.registerTool(
    'yinghuo_contacts',
    {
      title: 'Contact windows',
      description:
        'Read-only. GET /api/contacts — open/closed windows, links, schedule, embedded plan metadata.',
      inputSchema: {},
    },
    async () => runTool('yinghuo_contacts', {}, () => client.getJson('/api/contacts')),
  );

  server.registerTool(
    'yinghuo_plan',
    {
      title: 'Contact plan status',
      description:
        'Read-only. GET /api/plan — plan version hash, source (boot|watch|http), ok/lastError.',
      inputSchema: {},
    },
    async () => runTool('yinghuo_plan', {}, () => client.getJson('/api/plan')),
  );

  server.registerTool(
    'yinghuo_plan_reload',
    {
      title: 'Reload contact plan',
      description:
        'WRITE. POST /api/plan/reload — re-read disk plan, or apply optional JSON body in-memory. Failed validation keeps the previous plan and returns errors.',
      inputSchema: {
        body: z
          .record(z.unknown())
          .optional()
          .describe('Optional full contact-plan JSON object; omit to reload from disk'),
      },
    },
    async ({ body }) =>
      runTool('yinghuo_plan_reload', { body: body ?? {} }, () =>
        body && Object.keys(body).length > 0
          ? client.postJson('/api/plan/reload', body)
          : client.postJson('/api/plan/reload', {}),
      ),
  );

  server.registerTool(
    'yinghuo_graph',
    {
      title: 'Local contact graph',
      description:
        'Read-only. GET /api/graph — nodes (componentId), edges, unhealthy peers, componentCount. Graph mode only.',
      inputSchema: {},
    },
    async () => runTool('yinghuo_graph', {}, () => client.getJson('/api/graph')),
  );

  server.registerTool(
    'yinghuo_graph_route',
    {
      title: 'Trial next-hop route',
      description:
        'Read-only. GET /api/graph/route?dst= — candidates, culled neighbors, selected nextHop with rolePenalty.',
      inputSchema: {
        dst: z.string().min(1).describe('Destination node id, e.g. Mars or node9'),
      },
    },
    async ({ dst }) => runTool('yinghuo_graph_route', { dst }, () => client.getJson('/api/graph/route', { dst })),
  );

  server.registerTool(
    'yinghuo_send',
    {
      title: 'Send bundle',
      description:
        'WRITE. POST /api/send — inject application traffic at this relay. Fails if role cannot inject (e.g. orbiter).',
      inputSchema: {
        dst: z.string().min(1).describe('Destination node name'),
        payload: z.string().describe('Payload string'),
        ttlMs: z.number().int().positive().optional().describe('TTL milliseconds'),
      },
    },
    async ({ dst, payload, ttlMs }) =>
      runTool('yinghuo_send', { dst, payload, ttlMs }, () =>
        client.postJson('/api/send', {
          dst,
          payload,
          ...(ttlMs !== undefined ? { ttlMs } : {}),
        }),
      ),
  );

  server.registerTool(
    'yinghuo_inbox',
    {
      title: 'Local inbox',
      description:
        'GET inbox. clear=false (default) peeks via /api/inbox; clear=true polls+clears via /api/recv?clear=1.',
      inputSchema: {
        clear: z
          .boolean()
          .optional()
          .describe('If true, consume messages (recv). Default false (peek).'),
      },
    },
    async ({ clear }) =>
      runTool('yinghuo_inbox', { clear: clear === true }, () =>
        clear
          ? client.getJson('/api/recv', { clear: '1' })
          : client.getJson('/api/inbox'),
      ),
  );

  return server;
}
