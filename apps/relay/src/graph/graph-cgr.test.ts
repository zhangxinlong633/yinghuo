import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CyclicSchedule } from '../bundle/bundle.types';
import { emptyGraph, edgeKey } from './graph-merge';
import { contactGraphRoute } from './graph-cgr';
import type { GraphEdge, GraphNode } from './graph.types';

const open: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30_000,
  openOffsetMs: 0,
  openDurationMs: 10_000,
};

const later: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 60_000,
  openOffsetMs: 5_000,
  openDurationMs: 10_000,
};

function node(id: string, x: number, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, eid: `ipn:${id}.1`, x, y: 0, role: 'orbiter', ...extra };
}

function edge(a: string, b: string, delayMs: number, schedule: CyclicSchedule = open): GraphEdge {
  return {
    a,
    b,
    delayMs,
    schedule,
    originatedAt: 1,
    hopCount: 0,
    direct: true,
  };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]) {
  const graph = emptyGraph();
  for (const n of nodes) graph.nodes.set(n.id, n);
  for (const e of edges) graph.edges.set(edgeKey(e.a, e.b), e);
  return graph;
}

test('CGR uses a farther waypoint when it is the only path to dst', () => {
  const graph = graphOf(
    [node('me', 0), node('Far', -5), node('dst', 10)],
    [edge('me', 'Far', 50), edge('Far', 'dst', 50)],
  );
  const r = contactGraphRoute({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['Far'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
  });
  assert.equal(r.nextHop, 'Far');
  assert.deepEqual(r.path, ['me', 'Far', 'dst']);
  assert.equal(r.arrivalMs, 100);
});

test('CGR picks earlier end-to-end delivery over a geographically closer neighbor', () => {
  const graph = graphOf(
    [node('me', 0), node('Near', 8), node('Relay', 3), node('dst', 10)],
    [
      edge('me', 'Near', 10),
      edge('Near', 'dst', 10, later),
      edge('me', 'Relay', 100),
      edge('Relay', 'dst', 100),
    ],
  );
  const r = contactGraphRoute({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['Near', 'Relay'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
  });
  assert.equal(r.nextHop, 'Relay');
  assert.deepEqual(r.path, ['me', 'Relay', 'dst']);
  assert.equal(r.arrivalMs, 200);
});

test('CGR skips unhealthy first hop', () => {
  const graph = graphOf(
    [node('me', 0), node('Bad', 4), node('Good', 5), node('dst', 10)],
    [edge('me', 'Bad', 10), edge('Bad', 'dst', 10), edge('me', 'Good', 80), edge('Good', 'dst', 80)],
  );
  const r = contactGraphRoute({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['Bad', 'Good'],
    unhealthy: new Set(['Bad']),
    now: 0,
    meRole: 'orbiter',
  });
  assert.equal(r.nextHop, 'Good');
  assert.deepEqual(r.path, ['me', 'Good', 'dst']);
});

test('CGR returns null when no contact path reaches dst', () => {
  const graph = graphOf([node('me', 0), node('dst', 10), node('A', 3)], [edge('me', 'A', 10)]);
  const r = contactGraphRoute({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['A'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
  });
  assert.equal(r.nextHop, null);
  assert.equal(r.path.length, 0);
});
