import { timingSafeEqual } from 'crypto';

export type TokenEnv = Record<string, string | undefined>;

function configured(env: TokenEnv): string | undefined {
  const t = env.DTN_JOIN_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

export function joinTokenOk(header: string | undefined, env: TokenEnv = process.env): boolean {
  const expected = configured(env);
  if (!expected) return true;
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function joinTokenHeaders(env: TokenEnv = process.env): Record<string, string> {
  const t = configured(env);
  return t ? { 'x-yinghuo-join-token': t } : {};
}
