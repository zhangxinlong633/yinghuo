/**
 * Resolve the target relay base URL for MCP tools.
 * Precedence: DTN_RELAY_URL → YINGHUO_RELAY_URL → DTN_NODE map → Earth :3101
 */
export function resolveRelayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DTN_RELAY_URL || env.YINGHUO_RELAY_URL;
  if (explicit && explicit.trim()) return stripSlash(explicit.trim());

  const node = (env.DTN_NODE ?? 'Earth').toLowerCase();
  if (node === 'mars') return 'http://127.0.0.1:3102';
  if (node === 'relay') return 'http://127.0.0.1:3103';
  return 'http://127.0.0.1:3101';
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
