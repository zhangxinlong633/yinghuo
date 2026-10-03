import type { NodeTier } from '../graph/region-policy';

export type ReplicaStrategy = 'nearest' | 'quality' | 'far';

export type ReplicaCandidate = {
  id: string;
  /** Euclidean distance from self (plan/graph coords). */
  dist: number;
  delayMs: number;
  unhealthy: boolean;
  /** roleRoutePenalty; lower is better. */
  rolePenalty: number;
};

export function replicaCount(
  env: Record<string, string | undefined> = process.env,
  opts?: { partitioning?: boolean; tier?: NodeTier },
): number {
  const raw = env.DTN_REPLICA_N;
  if (raw === undefined || raw === '') {
    if (opts?.partitioning && opts.tier === 'edge') return 0;
    return 2;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.floor(n);
}

export function replicaStrategy(
  env: Record<string, string | undefined> = process.env,
): ReplicaStrategy {
  const raw = (env.DTN_REPLICA_STRATEGY ?? '').trim().toLowerCase();
  if (raw === 'nearest' || raw === 'near' || raw === '最近') return 'nearest';
  if (raw === 'far' || raw === 'distant' || raw === '远' || raw === '距离远') return 'far';
  if (raw === 'quality' || raw === '质量' || raw === '质量高') return 'quality';
  if (raw === '' || raw === undefined) return 'quality';
  return 'quality';
}

function asCandidate(peer: string | ReplicaCandidate): ReplicaCandidate {
  if (typeof peer === 'string') {
    return { id: peer, dist: 0, delayMs: 0, unhealthy: false, rolePenalty: 0 };
  }
  return peer;
}

function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rank(c: ReplicaCandidate, strategy: ReplicaStrategy): number[] {
  const down = c.unhealthy ? 1 : 0;
  if (strategy === 'nearest') return [down, c.dist];
  if (strategy === 'far') return [down, -c.dist];
  return [down, c.delayMs + c.rolePenalty, c.dist];
}

function better(
  a: ReplicaCandidate,
  b: ReplicaCandidate,
  strategy: ReplicaStrategy,
): number {
  const ra = rank(a, strategy);
  const rb = rank(b, strategy);
  for (let i = 0; i < ra.length; i++) {
    const d = ra[i]! - rb[i]!;
    if (d !== 0) return d;
  }
  return cmpId(a.id, b.id);
}

export function pickReplicaTargets(opts: {
  self: string;
  peers: Array<string | ReplicaCandidate>;
  exclude?: string[];
  n: number;
  strategy?: ReplicaStrategy;
}): string[] {
  const ban = new Set([opts.self, ...(opts.exclude ?? [])]);
  const strategy = opts.strategy ?? 'quality';
  return opts.peers
    .map(asCandidate)
    .filter((c) => c.id && !ban.has(c.id))
    .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
    .sort((a, b) => better(a, b, strategy))
    .slice(0, Math.max(0, opts.n))
    .map((c) => c.id);
}
