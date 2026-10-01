#!/usr/bin/env node
/**
 * Yinghuo MCP server (stdio).
 * Log only to stderr — stdout is the MCP JSON-RPC channel.
 *
 * Env: DTN_RELAY_URL | YINGHUO_RELAY_URL | DTN_NODE
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RelayHttpClient } from './relay-client.js';
import { resolveRelayUrl } from './relay-url.js';
import { createYinghuoServer } from './server.js';

async function main(): Promise<void> {
  const baseUrl = resolveRelayUrl();
  const client = new RelayHttpClient({ baseUrl });
  const server = createYinghuoServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`yinghuo-mcp ready relay=${baseUrl}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
