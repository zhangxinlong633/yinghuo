import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeKey } from './graph-merge';
import { labelNodesWithComponents, weakComponents } from './graph-components';
import type { GraphEdge, GraphNode, LocalGraph } from './graph.types';

const open = {
  type: 'cyclic' as const,
  periodMs: 30_000,
  openOffsetMs: 0,
  openDurationMs: 30_000,
};

function node(id: string): GraphNode {
  return { id, eid: `ipn:${id}.1`, x: 0, y: 0 };
}

function edge(a: string, b: string): GraphEdge {
  return {
    a,
    b,
    delayMs: 0,
    schedule: open,
    originatedAt: 1,
    hopCount: 0,
    direct: true,
  };
}

function graph(ids: string[], pairs: Array<[string, string]>): LocalGraph {
  const nodes = new Map(ids.map((id) => [id, node(id)]));
  const edges = new Map<string, GraphEdge>();
  for (const [a, b] of pairs) {
    edges.set(edgeKey(a, b), edge(a, b));
  }
  return { nodes, edges };
}

test('two disjoint edges yield two components', () => {
  const g = graph(['a0', 'a1', 'b0', 'b1'], [
    ['a0', 'a1'],
    ['b0', 'b1'],
  ]);
  const { componentCount, componentIdByNode } = weakComponents(g);
  assert.equal(componentCount, 2);
  assert.equal(componentIdByNode.get('a0'), componentIdByNode.get('a1'));
  assert.equal(componentIdByNode.get('b0'), componentIdByNode.get('b1'));
  assert.notEqual(componentIdByNode.get('a0'), componentIdByNode.get('b0'));
  // Stable: component 0 is the one whose smallest id sorts first (a0 < b0)
  assert.equal(componentIdByNode.get('a0'), 0);
  assert.equal(componentIdByNode.get('b0'), 1);
});

test('bridge edge merges into one component', () => {
  const g = graph(['a0', 'a1', 'b0', 'bridge'], [
    ['a0', 'a1'],
    ['a0', 'bridge'],
    ['bridge', 'b0'],
  ]);
  const { componentCount, componentIdByNode } = weakComponents(g);
  assert.equal(componentCount, 1);
  assert.equal(componentIdByNode.get('a1'), 0);
  assert.equal(componentIdByNode.get('b0'), 0);
});

test('isolated nodes are their own components', () => {
  const g = graph(['solo', 'a', 'b'], [['a', 'b']]);
  const { componentCount, componentIdByNode } = weakComponents(g);
  assert.equal(componentCount, 2);
  assert.equal(componentIdByNode.get('a'), componentIdByNode.get('b'));
  assert.notEqual(componentIdByNode.get('solo'), componentIdByNode.get('a'));
});

test('labelNodesWithComponents attaches ids', () => {
  const g = graph(['x', 'y'], [['x', 'y']]);
  const labels = weakComponents(g);
  const labeled = labelNodesWithComponents([...g.nodes.values()], labels);
  assert.equal(labeled.length, 2);
  assert.equal(labeled[0]!.componentId, 0);
});
