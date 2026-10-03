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

function isForeignRegion(region: string | undefined, localRegion: string): boolean {
  return region !== undefined && region !== '' && region !== localRegion;
}

export function mergeSummary(
  local: LocalGraph,
  incoming: GraphSummary,
  opts: { maxHop: number; now: number; localRegion?: string | null },
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

  const localRegion = opts.localRegion;
  if (localRegion !== undefined && localRegion !== null && localRegion !== '') {
    const removed = new Set<string>();
    for (const [id, node] of nodes) {
      if (isForeignRegion(node.region, localRegion)) {
        nodes.delete(id);
        removed.add(id);
      }
    }

    for (const [key, edge] of edges) {
      if (removed.has(edge.a) || removed.has(edge.b)) {
        edges.delete(key);
        continue;
      }
      const nodeA = nodes.get(edge.a);
      const nodeB = nodes.get(edge.b);
      if (
        isForeignRegion(nodeA?.region, localRegion) ||
        isForeignRegion(nodeB?.region, localRegion)
      ) {
        edges.delete(key);
      }
    }
  }

  return { nodes, edges };
}
