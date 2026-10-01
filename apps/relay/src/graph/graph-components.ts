import { edgeKey } from './graph-merge';
import type { LocalGraph } from './graph.types';

export type ComponentLabels = {
  /** Stable id per node: components ordered by lexicographically smallest member id. */
  componentIdByNode: Map<string, number>;
  componentCount: number;
};

/**
 * Weakly connected components over undirected contact edges.
 * Isolated nodes (no edges) each form their own component.
 */
export function weakComponents(graph: LocalGraph): ComponentLabels {
  const adj = new Map<string, Set<string>>();
  for (const id of graph.nodes.keys()) {
    adj.set(id, new Set());
  }
  for (const edge of graph.edges.values()) {
    if (!adj.has(edge.a)) adj.set(edge.a, new Set());
    if (!adj.has(edge.b)) adj.set(edge.b, new Set());
    adj.get(edge.a)!.add(edge.b);
    adj.get(edge.b)!.add(edge.a);
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  const ids = [...adj.keys()].sort();
  for (const start of ids) {
    if (seen.has(start)) continue;
    const members: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      members.push(cur);
      for (const nb of [...(adj.get(cur) ?? [])].sort()) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    members.sort();
    components.push(members);
  }
  components.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));

  const componentIdByNode = new Map<string, number>();
  components.forEach((members, idx) => {
    for (const id of members) componentIdByNode.set(id, idx);
  });
  return { componentIdByNode, componentCount: components.length };
}

/** Convenience: annotate node list with componentId (mutates copies). */
export function labelNodesWithComponents<T extends { id: string }>(
  nodes: T[],
  labels: ComponentLabels,
): Array<T & { componentId: number }> {
  return nodes.map((n) => ({
    ...n,
    componentId: labels.componentIdByNode.get(n.id) ?? 0,
  }));
}
