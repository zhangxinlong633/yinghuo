import { resolveMissionRole } from '../role/role-policy';

export type NodeTier = 'backbone' | 'edge';

export function regionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.DTN_REGION ?? '').trim() !== '';
}

export function localRegion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const r = (env.DTN_REGION ?? '').trim();
  return r === '' ? null : r;
}

export function parseTier(raw: string | undefined, role?: string): NodeTier {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'backbone' || t === '骨干') return 'backbone';
  if (t === 'edge' || t === 'leaf' || t === '叶子') return 'edge';
  const mission = resolveMissionRole(role ?? 'lander');
  if (mission === 'orbiter' || mission === 'cruise') return 'backbone';
  return 'edge';
}

export function localTier(
  env: Record<string, string | undefined> = process.env,
  role?: string,
): NodeTier {
  return parseTier(env.DTN_TIER, role ?? env.ROLE);
}

export function parseRegionPeers(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function joinAllowed(opts: {
  partitioning: boolean;
  localRegion: string;
  remoteRegion?: string;
  localTier: NodeTier;
  remoteTier: NodeTier;
  regionPeerKeys: string[];
}): { ok: true } | { ok: false; error: 'REGION_MISMATCH' } {
  if (!opts.partitioning) return { ok: true };
  const remote = (opts.remoteRegion ?? '').trim();
  if (!remote || remote === opts.localRegion) return { ok: true };
  const gateway =
    opts.localTier === 'backbone' &&
    opts.remoteTier === 'backbone' &&
    opts.regionPeerKeys.includes(remote);
  if (gateway) return { ok: true };
  return { ok: false, error: 'REGION_MISMATCH' };
}
