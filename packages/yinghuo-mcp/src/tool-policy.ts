export type McpMode = 'read' | 'write';
export type EnvMap = Record<string, string | undefined>;

const WRITE_TOOLS = new Set(['yinghuo_send', 'yinghuo_plan_reload']);

export function mcpMode(env: EnvMap = process.env): McpMode {
  const v = (env.YINGHUO_MCP_MODE ?? '').toLowerCase();
  return v === 'read' || v === 'readonly' ? 'read' : 'write';
}

export function isWriteTool(name: string, args: Record<string, unknown> = {}): boolean {
  if (WRITE_TOOLS.has(name)) return true;
  if (name === 'yinghuo_inbox' && args.clear === true) return true;
  return false;
}

export function assertToolAllowed(
  name: string,
  args: Record<string, unknown> = {},
  env: EnvMap = process.env,
): void {
  if (mcpMode(env) === 'read' && isWriteTool(name, args)) {
    throw new Error(`tool ${name} is write-only; YINGHUO_MCP_MODE=read`);
  }
}

export function bearerOk(header: string | undefined, env: EnvMap = process.env): boolean {
  const token = env.YINGHUO_MCP_TOKEN;
  if (!token) return false;
  const got = String(header ?? '');
  const prefix = /^Bearer\s+/i;
  const value = prefix.test(got) ? got.replace(prefix, '') : got;
  return value === token;
}

export function requireHttpToken(env: EnvMap = process.env): boolean {
  return Boolean(env.YINGHUO_MCP_TOKEN);
}
