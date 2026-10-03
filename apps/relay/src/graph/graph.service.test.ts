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
    roleByNode: {},
    port: 3101,
    peerUrl: 'http://127.0.0.1:3101',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    planStatus: {
      path: '',
      version: 't',
      loadedAt: 0,
      source: 'boot',
      ok: true,
      lastError: null,
      lastFailedAt: null,
      watchEnabled: false,
    },
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
  assert.deepEqual(snap.peers, [
    { id: 'Probe', url: 'http://127.0.0.1:3200', unhealthy: false, unhealthyRemainMs: 0 },
  ]);
  assert.equal(snap.stats.nodeCount, 2);
  assert.equal(snap.stats.peerCount, 1);
  assert.equal(snap.stats.unhealthyCount, 0);
  assert.deepEqual(snap.unhealthy, []);
});

test('snapshot exposes unhealthy peers and heard stale flags', () => {
  const prevU = process.env.DTN_UNHEALTHY_MS;
  const prevS = process.env.DTN_HEARD_STALE_MS;
  process.env.DTN_UNHEALTHY_MS = '5000';
  process.env.DTN_HEARD_STALE_MS = '1000';
  try {
    const graph = new GraphService(cfg());
    graph.upsertDirectPeer(
      'Near',
      'http://127.0.0.1:1',
      { id: 'Near', eid: 'ipn:2.1', x: 1, y: 0 },
      openNow,
      0,
    );
    graph.ingestSummary(
      {
        from: 'Near',
        nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
        edges: [
          {
            a: 'Near',
            b: 'Mars',
            delayMs: 1,
            schedule: openNow,
            originatedAt: 0,
            hopCount: 0,
          },
        ],
      },
      0,
    );
    graph.markUnhealthy('Near', 10_000);
    const snap = graph.snapshot(10_500);
    assert.equal(snap.stats.unhealthyMs, 5000);
    assert.equal(snap.stats.heardStaleMs, 1000);
    assert.equal(snap.stats.unhealthyCount, 1);
    assert.equal(snap.unhealthy[0]?.id, 'Near');
    assert.equal(snap.unhealthy[0]?.remainMs, 4500);
    assert.equal(snap.peers.find((p) => p.id === 'Near')?.unhealthy, true);
    const heard = snap.edges.find((e) => e.a === 'Mars' || e.b === 'Mars');
    assert.equal(heard?.kind, 'heard');
    assert.equal(heard?.stale, true);
    assert.ok((heard?.ageMs ?? 0) >= 10_500);
    assert.equal(snap.stats.heardStaleCount, 1);
  } finally {
    if (prevU === undefined) delete process.env.DTN_UNHEALTHY_MS;
    else process.env.DTN_UNHEALTHY_MS = prevU;
    if (prevS === undefined) delete process.env.DTN_HEARD_STALE_MS;
    else process.env.DTN_HEARD_STALE_MS = prevS;
  }
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

test('ingestSummary copies node EIDs into eidByNode', () => {
  const runtime = cfg();
  const graph = new GraphService(runtime);
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'dst', eid: 'ipn:9.9', x: 10, y: 0 }],
    edges: [],
  });
  assert.equal(runtime.eidByNode.dst, 'ipn:9.9');
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

function restoreRegionEnv(prev: {
  DTN_REGION: string | undefined;
  DTN_TIER: string | undefined;
  DTN_REGION_PEERS: string | undefined;
}): void {
  if (prev.DTN_REGION === undefined) delete process.env.DTN_REGION;
  else process.env.DTN_REGION = prev.DTN_REGION;
  if (prev.DTN_TIER === undefined) delete process.env.DTN_TIER;
  else process.env.DTN_TIER = prev.DTN_TIER;
  if (prev.DTN_REGION_PEERS === undefined) delete process.env.DTN_REGION_PEERS;
  else process.env.DTN_REGION_PEERS = prev.DTN_REGION_PEERS;
}

test('evaluateJoin rejects foreign edge when DTN_REGION set', () => {
  const prev = {
    DTN_REGION: process.env.DTN_REGION,
    DTN_TIER: process.env.DTN_TIER,
    DTN_REGION_PEERS: process.env.DTN_REGION_PEERS,
  };
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  delete process.env.DTN_REGION_PEERS;
  try {
    const graph = new GraphService(cfg({ role: 'orbiter' }));
    const no = graph.evaluateJoin({
      nodeId: 'Phobos', eid: 'ipn:9.1', port: 9, x: 9, y: 0,
      peerUrl: 'http://127.0.0.1:9', role: 'lander', region: 'mars',
    });
    assert.equal(no.ok, false);
  } finally {
    restoreRegionEnv(prev);
  }
});

test('evaluateJoin allows foreign backbone listed in DTN_REGION_PEERS', () => {
  const prev = {
    DTN_REGION: process.env.DTN_REGION,
    DTN_TIER: process.env.DTN_TIER,
    DTN_REGION_PEERS: process.env.DTN_REGION_PEERS,
  };
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  process.env.DTN_REGION_PEERS = 'mars=http://127.0.0.1:3202';
  try {
    const graph = new GraphService(cfg({ role: 'orbiter' }));
    const ok = graph.evaluateJoin({
      nodeId: 'MarsGw', eid: 'ipn:3.1', port: 3202, x: 3, y: 0,
      peerUrl: 'http://127.0.0.1:3202', role: 'orbiter', region: 'mars', tier: 'backbone',
    });
    assert.equal(ok.ok, true);
  } finally {
    restoreRegionEnv(prev);
  }
});

test('edge exportSummary omits heard edges', () => {
  const prev = {
    DTN_REGION: process.env.DTN_REGION,
    DTN_TIER: process.env.DTN_TIER,
    DTN_REGION_PEERS: process.env.DTN_REGION_PEERS,
  };
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'edge';
  delete process.env.DTN_REGION_PEERS;
  try {
    const graph = new GraphService(cfg({ nodeId: 'Handset', role: 'lander' }));
    graph.applyJoin({
      nodeId: 'Relay', eid: 'ipn:2.1', port: 2, x: 1, y: 0,
      peerUrl: 'http://127.0.0.1:2', role: 'orbiter', region: 'earth',
    });
    graph.ingestSummary({
      from: 'Relay',
      nodes: [{ id: 'Far', eid: 'ipn:8.1', x: 8, y: 0, region: 'earth' }],
      edges: [{
        a: 'Relay', b: 'Far', delayMs: 1, schedule: openNow, originatedAt: Date.now(), hopCount: 0,
      }],
    });
    const sum = graph.exportSummary();
    assert.equal(sum.edges.every((e) => e.direct === true || e.a === 'Handset' || e.b === 'Handset'), true);
    assert.equal(sum.nodes.some((n) => n.id === 'Far'), false);
  } finally {
    restoreRegionEnv(prev);
  }
});

test('listed backbone mutual join records each side as its own door', () => {
  const prev = {
    DTN_REGION: process.env.DTN_REGION,
    DTN_TIER: process.env.DTN_TIER,
    DTN_REGION_PEERS: process.env.DTN_REGION_PEERS,
  };
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  process.env.DTN_REGION_PEERS = 'mars=http://127.0.0.1:3202';
  try {
    const earth = new GraphService(cfg({ nodeId: 'Earth', eid: 'ipn:1.1', role: 'orbiter' }));
    earth.applyJoin({
      nodeId: 'MarsGw', eid: 'ipn:3.1', port: 3202, x: 30, y: 0,
      peerUrl: 'http://127.0.0.1:3202', role: 'orbiter', region: 'mars', tier: 'backbone',
    });
    const response = earth.buildJoinResponse();
    assert.deepEqual(earth.listGateways(), [
      { region: 'mars', nodeId: 'Earth', eid: 'ipn:1.1' },
    ]);
    assert.equal(earth.listKnownNodeIds().includes('MarsGw'), false);
    assert.equal(earth.peerUrl('MarsGw'), 'http://127.0.0.1:3202');

    process.env.DTN_REGION = 'mars';
    process.env.DTN_REGION_PEERS = 'earth=http://127.0.0.1:3101';
    const mars = new GraphService(cfg({
      nodeId: 'MarsGw', eid: 'ipn:3.1', role: 'orbiter', port: 3202,
      peerUrl: 'http://127.0.0.1:3202',
    }));
    mars.acceptBootstrap('http://127.0.0.1:3101', response);
    assert.deepEqual(mars.listGateways(), [
      { region: 'earth', nodeId: 'MarsGw', eid: 'ipn:3.1' },
    ]);
    assert.equal(mars.listKnownNodeIds().includes('Earth'), false);
    assert.equal(mars.peerUrl('Earth'), 'http://127.0.0.1:3101');

    process.env.DTN_REGION = 'earth';
    const camp = new GraphService(cfg({ nodeId: 'Camp', eid: 'ipn:2.1', role: 'orbiter', x: 4, y: 0 }));
    camp.acceptBootstrap('http://127.0.0.1:3101', response);
    const hop = camp.decide('Phobos', 1_000, 'mars');
    assert.equal(hop.nextHop, 'Earth');
  } finally {
    restoreRegionEnv(prev);
  }
});

test('backbone exportSummary lists foreign gateways and skips foreign eids', () => {
  const prev = {
    DTN_REGION: process.env.DTN_REGION,
    DTN_TIER: process.env.DTN_TIER,
    DTN_REGION_PEERS: process.env.DTN_REGION_PEERS,
  };
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  process.env.DTN_REGION_PEERS = 'mars=http://127.0.0.1:3202';
  try {
    const runtime = cfg({ role: 'orbiter' });
    const graph = new GraphService(runtime);
    graph.applyJoin({
      nodeId: 'MarsGw', eid: 'ipn:3.1', port: 3202, x: 3, y: 0,
      peerUrl: 'http://127.0.0.1:3202', role: 'orbiter', region: 'mars', tier: 'backbone',
    });
    graph.ingestSummary({
      from: 'MarsGw',
      nodes: [{ id: 'Phobos', eid: 'ipn:9.1', x: 9, y: 0, region: 'mars' }],
      edges: [],
      gateways: [{ region: 'venus', nodeId: 'VenusGw', eid: 'ipn:4.1' }],
    });
    assert.equal(runtime.eidByNode.Phobos, undefined);
    assert.equal(runtime.eidByNode.MarsGw, undefined);
    assert.equal(graph.listKnownNodeIds().includes('MarsGw'), false);
    assert.equal(graph.peerUrl('MarsGw'), 'http://127.0.0.1:3202');
    assert.deepEqual(graph.listGateways(), [
      { region: 'mars', nodeId: 'Earth', eid: 'ipn:1.1' },
      { region: 'venus', nodeId: 'VenusGw', eid: 'ipn:4.1' },
    ]);
    const sum = graph.exportSummary();
    assert.deepEqual(sum.gateways, graph.listGateways());
    assert.equal(sum.nodes.some((n) => n.id === 'Phobos'), false);
  } finally {
    restoreRegionEnv(prev);
  }
});
