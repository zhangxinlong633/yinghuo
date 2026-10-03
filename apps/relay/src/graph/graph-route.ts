import { msUntilOpen } from '../contact/contact-window';
import { edgeKey } from './graph-merge';
import type { LocalGraph, RegionGateway } from './graph.types';
import { contactGraphRoute } from './graph-cgr';
import { roleRoutePenalty, type NodeRole } from '../role/role-policy';
import { parseTier, type NodeTier } from './region-policy';

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
  algo?: 'cgr' | 'sabr-lite' | 'edge-uplink';
  path?: string[];
  arrivalMs?: number | null;
};

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

/** SABR-lite geographic greedy (CGR fallback). */
export function decideNextHop(input: {
  me: string;
  dst: string;
  graph: LocalGraph;
  peerIds: string[];
  unhealthy: Set<string>;
  now: number;
  meRole?: NodeRole | string;
  dstRegion?: string;
  meTier?: NodeTier;
  partitioning?: boolean;
  gateways?: RegionGateway[];
  /** Foreign peer to use when this node is the advertised door for that region. */
  regionHops?: Array<{ region: string; nodeId: string }>;
}): RouteDecision {
  const { me, graph, peerIds, unhealthy, now } = input;
  let dst = input.dst;
  const meRole = input.meRole ?? graph.nodes.get(me)?.role ?? 'endpoint';
  const cgrOff = process.env.DTN_CGR === '0' || process.env.DTN_CGR === 'false';

  const meNode = graph.nodes.get(me);

  if (input.partitioning && input.meTier === 'edge') {
    return edgeUplink({ me, graph, peerIds, unhealthy, now, meRole });
  }

  let dstNode = graph.nodes.get(dst);
  if (dstNode === undefined) {
    if (!input.dstRegion) {
      return unknownDestination();
    }
    const gateway = (input.gateways ?? []).find((g) => g.region === input.dstRegion);
    if (!gateway) {
      return {
        nextHop: null,
        reason: 'no region gateway',
        candidates: [],
        culled: [],
        algo: 'cgr',
      };
    }
    if (gateway.nodeId === me) {
      return foreignDoorHop(input.regionHops, input.dstRegion, unhealthy);
    }
    const gatewayNode = graph.nodes.get(gateway.nodeId);
    if (gatewayNode === undefined && peerIds.includes(gateway.nodeId)) {
      if (unhealthy.has(gateway.nodeId)) {
        return {
          nextHop: null,
          reason: 'region gateway unhealthy',
          candidates: [],
          culled: [],
          algo: 'cgr',
        };
      }
      return {
        nextHop: gateway.nodeId,
        reason: `region gateway ${gateway.nodeId}`,
        candidates: [],
        culled: [],
        algo: 'cgr',
      };
    }
    dst = gateway.nodeId;
    dstNode = gatewayNode;
    if (dstNode === undefined) {
      return unknownDestination();
    }
  }

  if (!cgrOff) {
    const cgr = contactGraphRoute({ ...input, dst });
    if (cgr.nextHop) {
      return {
        nextHop: cgr.nextHop,
        reason: cgr.reason,
        candidates: cgr.candidates.map((h) => ({
          neighbor: h.neighbor,
          distMe: 0,
          distNb: 0,
          waitMs: h.waitMs,
          delayMs: h.delayMs,
          rolePenaltyMs: 0,
          costMs: h.arrivalMs - now,
          closer: true,
        })),
        culled: [],
        algo: 'cgr',
        path: cgr.path,
        arrivalMs: cgr.arrivalMs,
      };
    }
  }

  if (meNode === undefined) {
    return {
      nextHop: null,
      reason: 'self not in local graph',
      candidates: [],
      culled: [],
      algo: 'sabr-lite',
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
      algo: 'sabr-lite',
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
    algo: 'sabr-lite',
  };
}

function foreignDoorHop(
  regionHops: Array<{ region: string; nodeId: string }> | undefined,
  dstRegion: string,
  unhealthy: Set<string>,
): RouteDecision {
  const hop = regionHops?.find((row) => row.region === dstRegion)?.nodeId;
  if (!hop || unhealthy.has(hop)) {
    return {
      nextHop: null,
      reason: 'region gateway unhealthy',
      candidates: [],
      culled: [],
      algo: 'cgr',
    };
  }
  return {
    nextHop: hop,
    reason: `region gateway ${hop}`,
    candidates: [],
    culled: [],
    algo: 'cgr',
  };
}

function unknownDestination(): RouteDecision {
  return {
    nextHop: null,
    reason: 'destination not in local graph',
    candidates: [],
    culled: [],
    algo: 'cgr',
  };
}

/** Edge always hands the bundle to the cheapest healthy backbone neighbor. */
function edgeUplink(input: {
  me: string;
  graph: LocalGraph;
  peerIds: string[];
  unhealthy: Set<string>;
  now: number;
  meRole: NodeRole | string;
}): RouteDecision {
  const { me, graph, peerIds, unhealthy, now, meRole } = input;
  const candidates: RouteCandidate[] = [];

  for (const neighbor of peerIds) {
    if (unhealthy.has(neighbor)) continue;
    const nbNode = graph.nodes.get(neighbor);
    if (nbNode === undefined) continue;
    if (parseTier(nbNode.tier, nbNode.role) !== 'backbone') continue;
    const edge = graph.edges.get(edgeKey(me, neighbor));
    if (edge === undefined) continue;

    const waitMs = msUntilOpen(now, edge.schedule);
    const delayMs = edge.delayMs;
    const nbRole = nbNode.role ?? 'endpoint';
    const rolePenaltyMs = roleRoutePenalty(meRole, nbRole);
    candidates.push({
      neighbor,
      distMe: 0,
      distNb: 0,
      waitMs,
      delayMs,
      rolePenaltyMs,
      costMs: waitMs + delayMs + rolePenaltyMs,
      closer: true,
      neighborRole: nbRole,
    });
  }

  if (candidates.length === 0) {
    return {
      nextHop: null,
      reason: 'no backbone uplink',
      candidates: [],
      culled: [],
      algo: 'edge-uplink',
    };
  }

  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.costMs < best.costMs || (c.costMs === best.costMs && c.neighbor < best.neighbor)) {
      best = c;
    }
  }

  return {
    nextHop: best.neighbor,
    reason: `edge uplink ${best.neighbor} (cost ${best.costMs}ms)`,
    candidates,
    culled: [],
    algo: 'edge-uplink',
  };
}
