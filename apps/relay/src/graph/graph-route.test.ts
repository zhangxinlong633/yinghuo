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
  upsertNode(graph, { id: 'me', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter' });
  upsertNode(graph, { id: 'dst', eid: 'ipn:3.1', x: 10, y: 0, role: 'lander' });
  upsertNode(graph, { id: 'A', eid: 'ipn:2.1', x: 3, y: 0, role: 'orbiter' });
  upsertNode(graph, { id: 'B', eid: 'ipn:2.2', x: 8, y: 0, role: 'orbiter' });
  upsertNode(graph, { id: 'C', eid: 'ipn:2.3', x: -1, y: 0, role: 'orbiter' });

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
    meRole: 'orbiter',
  });

  assert.equal(decision.nextHop, 'B');
  assert.equal(decision.culled.length, 1);
  assert.equal(decision.culled[0]?.neighbor, 'C');
  assert.equal(decision.culled[0]?.closer, false);
  const a = decision.candidates.find((c) => c.neighbor === 'A');
  const b = decision.candidates.find((c) => c.neighbor === 'B');
  assert.equal(a?.waitMs, 5000);
  assert.equal(a?.rolePenaltyMs, 0);
  assert.equal(a?.costMs, 5100);
  assert.equal(b?.waitMs, 0);
  assert.equal(b?.costMs, 200);
});

test('lander prefers orbiter over ground when wait+delay equal', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'me', eid: 'ipn:1.1', x: 0, y: 0, role: 'lander' });
  upsertNode(graph, { id: 'dst', eid: 'ipn:3.1', x: 10, y: 0 });
  upsertNode(graph, { id: 'GroundPad', eid: 'ipn:2.1', x: 4, y: 0, role: 'ground' });
  upsertNode(graph, { id: 'Orbiter', eid: 'ipn:2.2', x: 5, y: 0, role: 'orbiter' });
  const base = { delayMs: 100, schedule: openNow, originatedAt: 1, hopCount: 0, direct: true };
  upsertEdge(graph, { a: 'me', b: 'GroundPad', ...base });
  upsertEdge(graph, { a: 'me', b: 'Orbiter', ...base });

  const decision = decideNextHop({
    me: 'me',
    dst: 'dst',
    graph,
    peerIds: ['GroundPad', 'Orbiter'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'lander',
  });

  assert.equal(decision.nextHop, 'Orbiter');
  const ground = decision.candidates.find((c) => c.neighbor === 'GroundPad');
  const orb = decision.candidates.find((c) => c.neighbor === 'Orbiter');
  assert.ok((ground?.costMs ?? 0) > (orb?.costMs ?? 0));
  assert.match(decision.reason, /Orbiter/);
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

test('unknown dst with dstRegion uses gateway nextHop', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter', region: 'earth' });
  upsertNode(graph, { id: 'MarsGw', eid: 'ipn:3.1', x: 10, y: 0, role: 'orbiter', region: 'earth' });
  upsertEdge(graph, {
    a: 'EarthGw', b: 'MarsGw', delayMs: 5, schedule: openNow, originatedAt: 1, hopCount: 0, direct: true,
  });
  const d = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: ['MarsGw'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [{ region: 'mars', nodeId: 'MarsGw', eid: 'ipn:3.1' }],
  });
  assert.equal(d.nextHop, 'MarsGw');
});

test('unhealthy foreign gateway hop is not selected', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter', region: 'earth' });
  const d = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: ['MarsPeer'],
    unhealthy: new Set(['MarsPeer']),
    now: 0,
    meRole: 'orbiter',
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [{ region: 'mars', nodeId: 'MarsPeer', eid: 'ipn:3.1' }],
  });
  assert.equal(d.nextHop, null);
  assert.equal(d.reason, 'region gateway unhealthy');
});

test('door uses healthy foreign peer when advertised gateway is self', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter', region: 'earth' });
  const healthy = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: ['MarsPeer'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [{ region: 'mars', nodeId: 'EarthGw', eid: 'ipn:1.1' }],
    regionHops: [{ region: 'mars', nodeId: 'MarsPeer' }],
  });
  assert.equal(healthy.nextHop, 'MarsPeer');

  const down = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: ['MarsPeer'],
    unhealthy: new Set(['MarsPeer']),
    now: 0,
    meRole: 'orbiter',
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [{ region: 'mars', nodeId: 'EarthGw', eid: 'ipn:1.1' }],
    regionHops: [{ region: 'mars', nodeId: 'MarsPeer' }],
  });
  assert.equal(down.nextHop, null);
  assert.equal(down.reason, 'region gateway unhealthy');
});

test('unknown dst with dstRegion and no gateway', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter' });
  const d = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: [],
    unhealthy: new Set(),
    now: 0,
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [],
  });
  assert.equal(d.nextHop, null);
  assert.equal(d.reason, 'no region gateway');
});

test('edge skips CGR and picks backbone peer', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'Phone', eid: 'ipn:4.1', x: 0, y: 0, role: 'lander', tier: 'edge' });
  upsertNode(graph, { id: 'Relay', eid: 'ipn:2.1', x: 1, y: 0, role: 'orbiter', tier: 'backbone' });
  upsertNode(graph, { id: 'Mars', eid: 'ipn:3.1', x: 50, y: 0, role: 'lander' });
  upsertEdge(graph, {
    a: 'Phone', b: 'Relay', delayMs: 1, schedule: openNow, originatedAt: 1, hopCount: 0, direct: true,
  });
  const d = decideNextHop({
    me: 'Phone',
    dst: 'Mars',
    graph,
    peerIds: ['Relay'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'lander',
    partitioning: true,
    meTier: 'edge',
  });
  assert.equal(d.nextHop, 'Relay');
  assert.equal(d.algo, 'edge-uplink');
});
