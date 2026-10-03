import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Request } from 'express';
import { loadBpCodec } from '../bp/bp-codec';
import { toWireBundle } from '../bp/wire';
import type { CustodyRecord, RelayBundle } from './bundle.types';
import { BundleService } from './bundle.service';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { DEFAULT_JOIN_SCHEDULE, GraphService } from '../graph/graph.service';
import type { GraphNode } from '../graph/graph.types';
import { RelayController } from '../relay/relay.controller';

class MemoryStore {
  bundles = new Map<string, string>();
  custody = new Map<string, string>();
  inbox: unknown[] = [];

  async putBundle(bundle: RelayBundle): Promise<void> {
    this.bundles.set(bundle.id, JSON.stringify(bundle));
  }

  async getBundle(id: string): Promise<RelayBundle | null> {
    const raw = this.bundles.get(id);
    return raw ? (JSON.parse(raw) as RelayBundle) : null;
  }

  async putCustody(rec: CustodyRecord): Promise<void> {
    this.custody.set(rec.bundleId, JSON.stringify(rec));
  }

  async getCustody(id: string): Promise<CustodyRecord | null> {
    const raw = this.custody.get(id);
    return raw ? (JSON.parse(raw) as CustodyRecord) : null;
  }

  async releaseCustody(id: string): Promise<void> {
    this.custody.delete(id);
  }

  async listPendingBundleIds(): Promise<string[]> {
    return [...this.custody.keys()];
  }

  async listBundleIds(): Promise<string[]> {
    return [...this.bundles.keys()];
  }

  async counts(): Promise<{ bundles: number; custody: number; index: number; inbox: number }> {
    return {
      bundles: this.bundles.size,
      custody: this.custody.size,
      index: this.bundles.size,
      inbox: this.inbox.length,
    };
  }

  getDataDir(): string {
    return '';
  }

  async deliverLocal(msg: unknown): Promise<void> {
    this.inbox.push(msg);
  }

  dropInbox(): void {
    this.inbox = [];
  }

  peekInbox(): unknown[] {
    return this.inbox;
  }
}

function runtime(): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Mars: 'ipn:3.1' },
    roleByNode: {},
    port: 3101,
    peerUrl: 'http://127.0.0.1:9',
    peers: {},
    role: 'endpoint',
    nextHop: { Mars: 'Near' },
    graphMode: true,
    x: 0,
    y: 0,
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
  };
}

function seedOpenPeers(graph: GraphService): void {
  for (const [id, url, eid, x] of [
    ['Near', 'http://127.0.0.1:9', 'ipn:2.1', 3],
    ['Far', 'http://127.0.0.1:8', 'ipn:2.2', -4],
    ['Spare', 'http://127.0.0.1:7', 'ipn:2.3', 1],
  ] as const) {
    graph.upsertDirectPeer(id, url, { id, eid, x, y: 0 }, DEFAULT_JOIN_SCHEDULE);
  }
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });
}

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function harness(cfg = runtime()) {
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  return { store, graph, peer, bundles };
}

describe('region replica', { concurrency: 1 }, () => {
  test('edge partition send does not copy replicas', async () => {
    await withEnv(
      { DTN_REGION: 'earth', DTN_TIER: 'edge', DTN_REPLICA_N: undefined },
      async () => {
        loadBpCodec();
        const { store, graph, peer, bundles } = harness();
        seedOpenPeers(graph);
        const replicaHops: string[] = [];
        peer.forwardTo = async (url, bundle, extraHeaders) => {
          if (extraHeaders?.['x-dtn-replica'] === '1') replicaHops.push(url);
          return { ok: false, error: 'down', wireBase64: bundle.wire };
        };

        const bundle = await bundles.send('Mars', 'hi');
        const status = await bundles.status();
        assert.deepEqual(replicaHops, []);
        assert.deepEqual(bundle.replicas ?? [], []);
        assert.equal(
          status.recentEvents.some((row) => row.event === 'REPLICA' || row.event === 'REPLICA_FAIL'),
          false,
        );
        assert.equal(status.replica.n, 0);
        assert.equal(store.bundles.size, 1);
      },
    );
  });

  test('send stores dstRegion on the bundle', async () => {
    await withEnv(
      { DTN_REGION: 'earth', DTN_TIER: 'edge', DTN_REPLICA_N: undefined },
      async () => {
        loadBpCodec();
        const { graph, peer, bundles } = harness();
        graph.upsertDirectPeer(
          'AaaForeign',
          'http://127.0.0.1:9',
          {
            id: 'AaaForeign',
            eid: 'ipn:2.1',
            x: 1,
            y: 0,
            role: 'orbiter',
            region: 'earth',
            tier: 'backbone',
          },
          DEFAULT_JOIN_SCHEDULE,
        );
        peer.forwardTo = async (_url, bundle) => ({
          ok: false,
          error: 'down',
          wireBase64: bundle.wire,
        });
        const bundle = await bundles.send('Mars', 'hi', 120_000, 'mars');
        assert.equal(bundle.dstRegion, 'mars');
      },
    );
  });

  test('partition replicas stay on same-region backbone peers', async () => {
    await withEnv(
      { DTN_REGION: 'earth', DTN_TIER: 'edge', DTN_REPLICA_N: '2' },
      async () => {
        loadBpCodec();
        const { graph, peer, bundles } = harness();
        const peers: Array<[string, string, GraphNode]> = [
          ['AaaForeign', 'http://127.0.0.1:9', { id: 'AaaForeign', eid: 'ipn:2.1', x: 8, y: 0, role: 'orbiter', region: 'mars', tier: 'backbone' }],
          ['ZebraForeign', 'http://127.0.0.1:8', { id: 'ZebraForeign', eid: 'ipn:2.2', x: 1, y: 0, role: 'orbiter', region: 'mars', tier: 'backbone' }],
          ['LocalBb', 'http://127.0.0.1:7', { id: 'LocalBb', eid: 'ipn:2.3', x: 5, y: 0, role: 'orbiter', region: 'earth', tier: 'backbone' }],
          ['NoRegionBb', 'http://127.0.0.1:6', { id: 'NoRegionBb', eid: 'ipn:2.4', x: 9, y: 0, role: 'orbiter', tier: 'backbone' }],
          ['EdgePal', 'http://127.0.0.1:5', { id: 'EdgePal', eid: 'ipn:2.5', x: 0, y: 0, role: 'lander', region: 'earth', tier: 'edge' }],
        ];
        for (const [id, url, node] of peers) {
          graph.upsertDirectPeer(id, url, node, DEFAULT_JOIN_SCHEDULE);
        }
        peer.forwardTo = async (_url, bundle, extraHeaders) => {
          if (extraHeaders?.['x-dtn-replica'] === '1') {
            return { ok: true, wireBase64: bundle.wire };
          }
          return { ok: false, error: 'down', wireBase64: bundle.wire };
        };

        const bundle = await bundles.send('Mars', 'hi');
        assert.deepEqual([...(bundle.replicas ?? [])].sort(), ['LocalBb', 'NoRegionBb']);
      },
    );
  });

  test('ingest after foreign gateway join does not replica-target that peer', async () => {
    await withEnv(
      {
        DTN_REGION: 'earth',
        DTN_TIER: 'backbone',
        DTN_REPLICA_N: '2',
        DTN_REGION_PEERS: 'mars=http://127.0.0.1:9',
      },
      async () => {
        loadBpCodec();
        const { graph, peer, bundles } = harness();
        graph.upsertDirectPeer(
          'LocalBb',
          'http://127.0.0.1:7',
          { id: 'LocalBb', eid: 'ipn:2.3', x: 5, y: 0, role: 'orbiter', region: 'earth', tier: 'backbone' },
          DEFAULT_JOIN_SCHEDULE,
        );
        graph.upsertDirectPeer(
          'Spare',
          'http://127.0.0.1:6',
          { id: 'Spare', eid: 'ipn:2.4', x: 1, y: 0, role: 'orbiter', region: 'earth', tier: 'backbone' },
          DEFAULT_JOIN_SCHEDULE,
        );
        graph.applyJoin({
          nodeId: 'MarsGw',
          eid: 'ipn:3.1',
          port: 9,
          x: 40,
          y: 0,
          peerUrl: 'http://127.0.0.1:9',
          role: 'orbiter',
          region: 'mars',
          tier: 'backbone',
        });
        graph.ingestSummary({
          from: 'LocalBb',
          nodes: [
            { id: 'LocalBb', eid: 'ipn:2.3', x: 5, y: 0, role: 'orbiter', region: 'earth', tier: 'backbone' },
            { id: 'Camp', eid: 'ipn:8.1', x: 20, y: 0, role: 'lander', region: 'earth', tier: 'edge' },
          ],
          edges: [{
            a: 'LocalBb',
            b: 'Camp',
            delayMs: 1,
            schedule: DEFAULT_JOIN_SCHEDULE,
            originatedAt: Date.now(),
            hopCount: 0,
          }],
        });
        peer.forwardTo = async (_url, bundle, extraHeaders) => {
          if (extraHeaders?.['x-dtn-replica'] === '1') {
            return { ok: true, wireBase64: bundle.wire };
          }
          return { ok: false, error: 'down', wireBase64: bundle.wire };
        };

        const bundle = await bundles.send('Camp', 'hi');
        assert.equal(graph.peerUrl('MarsGw'), 'http://127.0.0.1:9');
        assert.equal(graph.listKnownNodeIds().includes('MarsGw'), false);
        assert.equal(
          graph.snapshot().edges.some((e) => e.a === 'MarsGw' || e.b === 'MarsGw'),
          false,
        );
        assert.equal((bundle.replicas ?? []).includes('MarsGw'), false);
        assert.equal((bundle.replicas ?? []).includes('Spare'), true);
      },
    );
  });
});

test('forwardTo sends x-dtn-dst-region when the bundle has one', async () => {
  const cfg = runtime();
  const peer = new PeerService(cfg);
  let headers: Record<string, string> | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    headers = init?.headers;
    return new Response(
      JSON.stringify({ accepted: true, delivered: false, event: 'STORE', msg: 'ok' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const result = await peer.forwardTo('http://127.0.0.1:9', {
      id: 'b-hdr',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      dstRegion: 'mars',
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
      wire: Buffer.from('wire').toString('base64'),
    });
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(headers?.['x-dtn-dst-region'], 'mars');
});

test('send body passes dstRegion and peerIngest trusts x-dtn-dst-region', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  let sendArgs: unknown[] = [];
  let seen: RelayBundle | undefined;
  const bundles = {
    async send(...args: unknown[]) {
      sendArgs = args;
      return { id: 'b', src: 'Earth', dst: 'Mars', payload: 'hi', ttlMs: 5 };
    },
    ingestFromPeer(bundle: RelayBundle) {
      seen = bundle;
      return { accepted: true, delivered: false, event: 'STORE', msg: 'ok' };
    },
    recordOps() {},
  };
  const contacts = { isOpenTo: () => false };
  const controller = new RelayController(bundles as never, contacts as never, cfg);
  await controller.send({ dst: 'Mars', payload: 'hi', ttlMs: 5, dstRegion: 'mars' });
  assert.deepEqual(sendArgs, ['Mars', 'hi', 5, 'mars']);

  const wire = toWireBundle(
    {
      id: 'b-cbor',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      createdAt: 1_600_000_000_000,
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    cfg,
  );
  await controller.peerIngest(
    { body: wire } as Request,
    'application/cbor',
    'Earth',
    'b-cbor',
    '1',
    undefined,
    undefined,
    undefined,
    'mars',
  );
  assert.equal(seen?.payload, 'hi');
  assert.equal(seen?.dstRegion, 'mars');
});
