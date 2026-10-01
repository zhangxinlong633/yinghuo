import type { GraphEdge, GraphSummary, LocalGraph } from './graph.types';

export type { GraphNode, GraphEdge, GraphSummary, LocalGraph } from './graph.types';

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function emptyGraph(): LocalGraph {
  return { nodes: new Map(), edges: new Map() };
}

function orderedEndpoints(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function mergeSummary(
  local: LocalGraph,
  incoming: GraphSummary,
  opts: { maxHop: number; now: number },
): LocalGraph {
  const nodes = new Map(local.nodes);
  const edges = new Map(local.edges);

  for (const node of incoming.nodes) {
    nodes.set(node.id, node);
  }

  for (const raw of incoming.edges) {
    const hopCount = raw.hopCount + 1;
    if (hopCount > opts.maxHop) continue;

    const [a, b] = orderedEndpoints(raw.a, raw.b);
    const key = edgeKey(a, b);
    const candidate: GraphEdge = { ...raw, a, b, hopCount };

    const existing = edges.get(key);
    if (existing === undefined || raw.originatedAt > existing.originatedAt) {
      edges.set(key, candidate);
    }
  }

  return { nodes, edges };
}
