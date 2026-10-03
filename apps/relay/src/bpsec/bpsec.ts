export type BpsecEnv = Record<string, string | undefined>;

export function bpsecEnabled(env: BpsecEnv = process.env): boolean {
  const v = env.DTN_BPSEC;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Demo integrity marker only — not CCSDS BPSec. */
export function bpsecIngestOk(header: string | undefined, env: BpsecEnv = process.env): boolean {
  if (!bpsecEnabled(env)) return true;
  return String(header ?? '').trim().toLowerCase() === 'integrity';
}

export function bpsecForwardHeaders(env: BpsecEnv = process.env): Record<string, string> {
  return bpsecEnabled(env) ? { 'x-dtn-bpsec': 'integrity' } : {};
}
