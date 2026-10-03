import { msUntilOpen } from '../contact/contact-window';
import { roleRoutePenalty, type NodeRole } from '../role/role-policy';
import { edgeKey, emptyGraph } from './graph-merge';
import type { GraphEdge, LocalGraph } from './graph.types';

export type CgrHop = {
  neighbor: string;
  arrivalMs: number;
  waitMs: number;
  delayMs: number;
};

export type CgrResult = {
  nextHop: string | null;
  path: string[];
  arrivalMs: number | null;
  hops: number;
  candidates: CgrHop[];
  reason: string;
};

const MAX_CGR_HOPS = 8;

function otherEnd(edge: GraphEdge, nodeId: string): string | null {
  if (edge.a === nodeId) return edge.b;
  if (edge.b === nodeId) return edge.a;
  return null;
}

function neighborsOf(graph: LocalGraph, nodeId: string): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.a === nodeId || edge.b === nodeId) out.push(edge);
  }
  return out;
}

/**
 * Earliest-delivery Dijkstra on the contact graph (CGR / SABR core).
 * First hop must be a direct peer. Unhealthy nodes are not expanded.
 */
export function contactGraphRoute(input: {
  me: string;
  dst: string;
  graph: LocalGraph;
  peerIds: string[];
  unhealthy: Set<string>;
  now: number;
  meRole?: NodeRole | string;
}): CgrResult {
  const { me, dst, graph, peerIds, unhealthy, now } = input;
  const empty: CgrResult = {
    nextHop: null,
    path: [],
    arrivalMs: null,
    hops: 0,
    candidates: [],
    reason: 'no contact path',
  };

  if (graph.nodes.get(dst) === undefined) {
    return { ...empty, reason: 'destination not in local graph' };
  }
  if (graph.nodes.get(me) === undefined) {
    return { ...empty, reason: 'self not in local graph' };
  }
  if (me === dst) {
    return { nextHop: null, path: [me], arrivalMs: now, hops: 0, candidates: [], reason: 'already at destination' };
  }

  const peerSet = new Set(peerIds);
  const meRole = input.meRole ?? graph.nodes.get(me)?.role ?? 'endpoint';

  type State = { t: number; node: string; firstHop: string | null; hops: number };
  const earliest = new Map<string, number>();
  const prev = new Map<string, { parent: string; firstHop: string }>();
  const queue: State[] = [{ t: now, node: me, firstHop: null, hops: 0 }];
  earliest.set(me, now);

  const firstHopBest = new Map<string, CgrHop>();

  while (queue.length > 0) {
    let bestI = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.t < queue[bestI]!.t) bestI = i;
    }
    const cur = queue.splice(bestI, 1)[0]!;
    if (cur.t !== earliest.get(cur.node)) continue;
    if (cur.node === dst) break;
    if (cur.hops >= MAX_CGR_HOPS) continue;

    for (const edge of neighborsOf(graph, cur.node)) {
      const v = otherEnd(edge, cur.node);
      if (!v || v === cur.node) continue;
      if (unhealthy.has(v)) continue;
      if (cur.node === me && !peerSet.has(v)) continue;

      const waitMs = msUntilOpen(cur.t, edge.schedule);
      if (!Number.isFinite(waitMs)) continue;
      const delayMs = edge.delayMs;
      let arrive = cur.t + waitMs + delayMs;
      const firstHop = cur.firstHop ?? v;
      if (cur.node === me) {
        const nbRole = graph.nodes.get(v)?.role ?? 'endpoint';
        arrive += roleRoutePenalty(meRole, nbRole);
        const hop: CgrHop = { neighbor: v, arrivalMs: arrive, waitMs, delayMs };
        const prevHop = firstHopBest.get(v);
        if (!prevHop || hop.arrivalMs < prevHop.arrivalMs) firstHopBest.set(v, hop);
      }

      const prior = earliest.get(v);
      if (prior !== undefined && arrive >= prior) continue;
      earliest.set(v, arrive);
      prev.set(v, { parent: cur.node, firstHop });
      queue.push({ t: arrive, node: v, firstHop, hops: cur.hops + 1 });
    }
  }

  const edt = earliest.get(dst);
  if (edt === undefined) {
    return { ...empty, candidates: [...firstHopBest.values()], reason: 'no contact path' };
  }
  const via = prev.get(dst);
  if (!via) {
    return { ...empty, reason: 'no contact path' };
  }

  const path: string[] = [dst];
  let walk: string | undefined = dst;
  const seen = new Set<string>([dst]);
  while (walk && walk !== me) {
    const step = prev.get(walk);
    if (!step) break;
    walk = step.parent;
    if (seen.has(walk)) break;
    seen.add(walk);
    path.push(walk);
  }
  path.reverse();
  const nextHop = via.firstHop;
  if (!peerSet.has(nextHop)) {
    return { ...empty, candidates: [...firstHopBest.values()], reason: 'cgr first hop is not a direct peer' };
  }

  return {
    nextHop,
    path,
    arrivalMs: edt,
    hops: path.length - 1,
    candidates: [...firstHopBest.values()].sort((a, b) => a.arrivalMs - b.arrivalMs),
    reason: `cgr ${path.join('→')} edt ${edt}ms`,
  };
}

export function edgeId(a: string, b: string): string {
  return edgeKey(a, b);
}

export function localGraphFromPlan(plan: {
  nodes: Array<{ name: string; eid?: string; role?: NodeRole; x?: number; y?: number }>;
  contacts: Array<{
    a: string;
    b: string;
    delayMs: number;
    schedule: GraphEdge['schedule'];
  }>;
}): LocalGraph {
  const graph = emptyGraph();
  for (const n of plan.nodes) {
    graph.nodes.set(n.name, {
      id: n.name,
      eid: n.eid ?? `ipn:${n.name}.1`,
      x: n.x ?? 0,
      y: n.y ?? 0,
      role: n.role,
    });
  }
  for (const c of plan.contacts) {
    graph.edges.set(edgeKey(c.a, c.b), {
      a: c.a,
      b: c.b,
      delayMs: c.delayMs,
      schedule: c.schedule,
      originatedAt: 0,
      hopCount: 0,
      direct: true,
    });
  }
  return graph;
}
