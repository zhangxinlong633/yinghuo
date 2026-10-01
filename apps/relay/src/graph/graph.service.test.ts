import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CyclicSchedule } from '../bundle/bundle.types';
import type { RelayRuntimeConfig } from '../config';
import { edgeKey } from './graph-merge';
import { GraphService } from './graph.service';

const openNow: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30000,
  openOffsetMs: 0,
  openDurationMs: 30000,
};

function cfg(partial: Partial<RelayRuntimeConfig> = {}): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1' },
    port: 3101,
    peerUrl: 'http://127.0.0.1:3101',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    startedAt: 0,
    graphMode: true,
    x: 0,
    y: 0,
    ...partial,
  };
}

test('ingestSummary merges nodes and increments hop, dropping above max', () => {
  const graph = new GraphService(cfg());
  graph.ingestSummary({
    from: 'Relay',
    nodes: [
      { id: 'Relay', eid: 'ipn:2.1', x: 4, y: 0 },
      { id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 },
    ],
    edges: [
      {
        a: 'Relay',
        b: 'Mars',
        delayMs: 200,
        schedule: openNow,
        originatedAt: 10,
        hopCount: 0,
      },
    ],
  });

  const summary = graph.exportSummary();
  const edge = summary.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('Relay', 'Mars'));
  assert.equal(edge?.hopCount, 1);
  assert.ok(summary.nodes.some((n) => n.id === 'Mars'));
  assert.deepEqual(graph.listKnownNodeIds().sort(), ['Earth', 'Mars', 'Relay']);

  graph.ingestSummary({
    from: 'Far',
    nodes: [{ id: 'Pluto', eid: 'ipn:9.1', x: 99, y: 0 }],
    edges: [
      {
        a: 'Pluto',
        b: 'Far',
        delayMs: 1,
        schedule: openNow,
        originatedAt: 20,
        hopCount: 3,
      },
    ],
  });
  assert.equal(
    graph.exportSummary().edges.some((e) => edgeKey(e.a, e.b) === edgeKey('Pluto', 'Far')),
    false,
  );
  assert.equal(graph.listKnownNodeIds().includes('Pluto'), true);
});

test('direct seed edges stay hop 0 when a newer heard summary arrives', () => {
  const graph = new GraphService(cfg());
  graph.upsertDirectPeer(
    'Relay',
    'http://127.0.0.1:3103',
    { id: 'Relay', eid: 'ipn:2.1', x: 4, y: 0 },
    openNow,
  );
  graph.ingestSummary({
    from: 'Relay',
    nodes: [{ id: 'Relay', eid: 'ipn:2.1', x: 4, y: 0 }],
    edges: [
      {
        a: 'Earth',
        b: 'Relay',
        delayMs: 999,
        schedule: openNow,
        originatedAt: 1_000_000,
        hopCount: 0,
      },
    ],
  });
  const edge = graph.exportSummary().edges.find((e) => edgeKey(e.a, e.b) === edgeKey('Earth', 'Relay'));
  assert.equal(edge?.direct, true);
  assert.equal(edge?.hopCount, 0);
  assert.equal(edge?.delayMs, 0);
});

test('applyJoin records a direct peer and buildJoinResponse exports it', () => {
  const graph = new GraphService(cfg({ eid: 'ipn:1.1' }));
  graph.applyJoin({
    nodeId: 'Probe',
    eid: 'ipn:8.1',
    port: 3200,
    x: 2,
    y: 3,
    peerUrl: 'http://127.0.0.1:3200',
  });
  assert.equal(graph.peerUrl('Probe'), 'http://127.0.0.1:3200');
  const res = graph.buildJoinResponse();
  assert.equal(res.ok, true);
  assert.equal(res.localEid, 'ipn:1.1');
  assert.equal(res.summary.from, 'Earth');
  const edge = res.summary.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('Earth', 'Probe'));
  assert.equal(edge?.direct, true);
  assert.equal(edge?.hopCount, 0);
  assert.equal(edge?.schedule.openDurationMs, edge?.schedule.periodMs);

  const snap = graph.snapshot(1_000);
  const snapEdge = snap.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('Earth', 'Probe'));
  assert.equal(snapEdge?.kind, 'direct');
  assert.deepEqual(snap.peers, [{ id: 'Probe', url: 'http://127.0.0.1:3200' }]);
  assert.equal(snap.stats.nodeCount, 2);
  assert.equal(snap.stats.peerCount, 1);
});

test('decide uses direct peers and skips unhealthy neighbors', () => {
  const graph = new GraphService(cfg({ x: 0, y: 0 }));
  graph.upsertDirectPeer('Near', 'http://127.0.0.1:1', { id: 'Near', eid: 'ipn:2.1', x: 3, y: 0 }, openNow);
  graph.upsertDirectPeer('Far', 'http://127.0.0.1:2', { id: 'Far', eid: 'ipn:2.2', x: -4, y: 0 }, openNow);
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });

  const open = graph.decide('Mars', 0);
  assert.equal(open.nextHop, 'Near');

  graph.markUnhealthy('Near');
  const blocked = graph.decide('Mars', Date.now());
  assert.equal(blocked.nextHop, null);

  const recovered = graph.decide('Mars', Date.now() + 60_000);
  assert.equal(recovered.nextHop, 'Near');
});

test('ingest does not overwrite local coordinates', () => {
  const graph = new GraphService(cfg({ x: 1, y: 2 }));
  graph.ingestSummary({
    from: 'Other',
    nodes: [{ id: 'Earth', eid: 'ipn:9.9', x: 50, y: 50 }],
    edges: [],
  });
  const self = graph.exportSummary().nodes.find((n) => n.id === 'Earth');
  assert.equal(self?.x, 1);
  assert.equal(self?.y, 2);
  assert.equal(self?.eid, 'ipn:1.1');
});
