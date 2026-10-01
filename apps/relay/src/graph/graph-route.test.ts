import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CyclicSchedule } from '../bundle/bundle.types';
import { emptyGraph, edgeKey } from './graph-merge';
import { decideNextHop } from './graph-route';
import type { GraphEdge, GraphNode } from './graph.types';

const openNow: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30000,
  openOffsetMs: 0,
  openDurationMs: 10000,
};

const openIn5s: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 60000,
  openOffsetMs: 5000,
  openDurationMs: 10000,
};

function upsertNode(graph: ReturnType<typeof emptyGraph>, node: GraphNode): void {
  graph.nodes.set(node.id, node);
}

function upsertEdge(graph: ReturnType<typeof emptyGraph>, edge: GraphEdge): void {
  graph.edges.set(edgeKey(edge.a, edge.b), edge);
}

test('culls farther neighbors then picks lowest wait+delay', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'me', eid: 'ipn:1.1', x: 0, y: 0 });
  upsertNode(graph, { id: 'dst', eid: 'ipn:3.1', x: 10, y: 0 });
  upsertNode(graph, { id: 'A', eid: 'ipn:2.1', x: 3, y: 0 });
  upsertNode(graph, { id: 'B', eid: 'ipn:2.2', x: 8, y: 0 });
  upsertNode(graph, { id: 'C', eid: 'ipn:2.3', x: -1, y: 0 });

  const base = { schedule: openNow, originatedAt: 1, hopCount: 0, direct: true };
  upsertEdge(graph, { a: 'me', b: 'A', delayMs: 100, ...base, schedule: openIn5s });
  upsertEdge(graph, { a: 'me', b: 'B', delayMs: 200, ...base });
  upsertEdge(graph, { a: 'me', b: 'C', delayMs: 50, ...base });

  const decision = decideNextHop({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['A', 'B', 'C'],
    unhealthy: new Set(),
    now: 0,
  });

  assert.equal(decision.nextHop, 'B');
  assert.equal(decision.culled.length, 1);
  assert.equal(decision.culled[0]?.neighbor, 'C');
  assert.equal(decision.culled[0]?.closer, false);
  const a = decision.candidates.find((c) => c.neighbor === 'A');
  const b = decision.candidates.find((c) => c.neighbor === 'B');
  assert.equal(a?.waitMs, 5000);
  assert.equal(a?.costMs, 5100);
  assert.equal(b?.waitMs, 0);
  assert.equal(b?.costMs, 200);
});

test('destination not in local graph', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'me', eid: 'ipn:1.1', x: 0, y: 0 });

  const decision = decideNextHop({
    me: 'me',
    dst: 'missing',
    graph,
    peerIds: [],
    unhealthy: new Set(),
    now: 0,
  });

  assert.equal(decision.nextHop, null);
  assert.equal(decision.reason, 'destination not in local graph');
  assert.deepEqual(decision.candidates, []);
  assert.deepEqual(decision.culled, []);
});
