import { msUntilOpen } from '../contact/contact-window';
import { edgeKey } from './graph-merge';
import type { LocalGraph } from './graph.types';
import { roleRoutePenalty, type NodeRole } from '../role/role-policy';

export type RouteCandidate = {
  neighbor: string;
  distMe: number;
  distNb: number;
  waitMs: number;
  delayMs: number;
  rolePenaltyMs: number;
  costMs: number;
  closer: boolean;
  neighborRole?: NodeRole;
};

export type RouteDecision = {
  nextHop: string | null;
  reason: string;
  candidates: RouteCandidate[];
  culled: RouteCandidate[];
};

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

/** SABR-lite: closer neighbors only; cost = wait-to-open + delay + rolePenalty. Not full CGR. */
export function decideNextHop(input: {
  me: string;
  dst: string;
  graph: LocalGraph;
  peerIds: string[];
  unhealthy: Set<string>;
  now: number;
  meRole?: NodeRole | string;
}): RouteDecision {
  const { me, dst, graph, peerIds, unhealthy, now } = input;
  const meRole = input.meRole ?? graph.nodes.get(me)?.role ?? 'endpoint';

  const meNode = graph.nodes.get(me);
  const dstNode = graph.nodes.get(dst);
  if (dstNode === undefined) {
    return {
      nextHop: null,
      reason: 'destination not in local graph',
      candidates: [],
      culled: [],
    };
  }

  if (meNode === undefined) {
    return {
      nextHop: null,
      reason: 'self not in local graph',
      candidates: [],
      culled: [],
    };
  }

  const distMe = distance(meNode.x, meNode.y, dstNode.x, dstNode.y);
  const candidates: RouteCandidate[] = [];
  const culled: RouteCandidate[] = [];

  for (const neighbor of peerIds) {
    if (unhealthy.has(neighbor)) continue;

    const nbNode = graph.nodes.get(neighbor);
    if (nbNode === undefined) continue;

    const edge = graph.edges.get(edgeKey(me, neighbor));
    if (edge === undefined) continue;

    const distNb = distance(nbNode.x, nbNode.y, dstNode.x, dstNode.y);
    const closer = distNb < distMe;
    const waitMs = msUntilOpen(now, edge.schedule);
    const delayMs = edge.delayMs;
    const nbRole = nbNode.role ?? 'endpoint';
    const rolePenaltyMs = roleRoutePenalty(meRole, nbRole);
    const entry: RouteCandidate = {
      neighbor,
      distMe,
      distNb,
      waitMs,
      delayMs,
      rolePenaltyMs,
      costMs: waitMs + delayMs + rolePenaltyMs,
      closer,
      neighborRole: nbRole,
    };

    if (closer) {
      candidates.push(entry);
    } else {
      culled.push(entry);
    }
  }

  if (candidates.length === 0) {
    return {
      nextHop: null,
      reason: culled.length > 0 ? 'no closer neighbor' : 'no routable neighbor',
      candidates: [],
      culled,
    };
  }

  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.costMs < best.costMs || (c.costMs === best.costMs && c.neighbor < best.neighbor)) {
      best = c;
    }
  }

  const bias =
    best.rolePenaltyMs > 0
      ? `; rolePenalty ${best.rolePenaltyMs}ms`
      : best.neighborRole
        ? `; via ${best.neighborRole}`
        : '';

  return {
    nextHop: best.neighbor,
    reason: `selected ${best.neighbor} (cost ${best.costMs}ms${bias})`,
    candidates,
    culled,
  };
}
