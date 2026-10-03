import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBpCodec } from '../bp/bp-codec';
import type { CustodyRecord, RelayBundle } from './bundle.types';
import { BundleService } from './bundle.service';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { DEFAULT_JOIN_SCHEDULE, GraphService } from '../graph/graph.service';
import { payloadSha256 } from './payload-hash';

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

function seed(graph: GraphService): void {
  for (const [id, url, eid, x] of [
    ['Near', 'http://127.0.0.1:9', 'ipn:2.1', 3],
    ['Far', 'http://127.0.0.1:8', 'ipn:2.2', -4],
    ['Spare', 'http://127.0.0.1:7', 'ipn:2.3', 1],
  ] as const) {
    graph.upsertDirectPeer(
      id,
      url,
      { id, eid, x, y: 0 },
      DEFAULT_JOIN_SCHEDULE,
    );
  }
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });
}

test('send copies bundle to two peers excluding next hop and dest', async () => {
  loadBpCodec();
  const cfg = runtime();
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  seed(graph);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  const replicaHops: string[] = [];
  peer.forwardTo = async (url, bundle, extraHeaders) => {
    if (extraHeaders?.['x-dtn-replica'] === '1') {
      replicaHops.push(url);
      return { ok: true, wireBase64: bundle.wire };
    }
    return { ok: false, error: 'down', wireBase64: bundle.wire };
  };
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );

  const bundle = await bundles.send('Mars', 'hi');
  assert.deepEqual(replicaHops.sort(), [
    'http://127.0.0.1:7',
    'http://127.0.0.1:8',
  ]);
  assert.equal(bundle.replicaRole, 'primary');
  assert.deepEqual([...(bundle.replicas ?? [])].sort(), ['Far', 'Spare']);
  assert.ok(store.custody.has(bundle.id));
});

test('replica ingest stores without custody or inbox delivery', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  let forwarded = 0;
  peer.forwardTo = async () => {
    forwarded += 1;
    return { ok: true };
  };
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );

  const incoming: RelayBundle = {
    id: 'b-1',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hi',
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
    replicaRole: 'primary',
  };
  const result = await bundles.ingestFromPeer(incoming, 'Earth', true);
  assert.equal(result.event, 'REPLICA_STORE');
  assert.equal(result.accepted, true);
  assert.equal(result.delivered, false);
  assert.equal(forwarded, 0);
  const stored = await store.getBundle('b-1');
  assert.equal(stored?.replicaRole, 'replica');
  assert.equal(stored?.replicaOf, 'Earth');
  assert.equal(stored?.custodian, 'Earth');
  assert.equal(store.custody.size, 0);
  assert.equal(store.inbox.length, 0);

  const dup = await bundles.ingestFromPeer(incoming, 'Earth', true);
  assert.equal(dup.duplicate, true);
  assert.equal(store.custody.size, 0);
});

test('replica ingest with bad sha256 records CORRUPT and skips custody', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
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
  const incoming: RelayBundle = {
    id: 'b-bad',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hj',
    payloadSha256: payloadSha256('hi'),
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
  };
  const result = await bundles.ingestFromPeer(incoming, 'Earth', true);
  assert.equal(result.event, 'CORRUPT');
  assert.equal(store.custody.size, 0);
  const stored = await store.getBundle('b-bad');
  assert.equal(stored?.replicaRole, 'replica');
  assert.equal(
    (stored?.events ?? []).some((e) => e.kind === 'CORRUPT'),
    true,
  );
});

test('promotes replica when replicaOf is unhealthy and hash ok', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  cfg.role = 'orbiter';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  graph.markUnhealthy('Earth');
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  peer.forwardTo = async (_url, bundle) => ({ ok: true, wireBase64: bundle.wire });
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  const hex = payloadSha256('hi');
  await bundles.ingestFromPeer(
    {
      id: 'b-prom',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      payloadSha256: hex,
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
    true,
  );
  const svc = bundles as unknown as { planTick(): Promise<{ forwards: unknown[] }> };
  await svc.planTick();
  const stored = await store.getBundle('b-prom');
  assert.equal(stored?.replicaRole, 'primary');
  assert.equal(stored?.custodian, 'Spare');
  assert.ok(store.custody.has('b-prom'));
  assert.equal((stored?.events ?? []).some((e) => e.kind === 'PROMOTE'), true);
});

test('does not promote when DTN_REPLICA_PROMOTE is 0', async () => {
  const prev = process.env.DTN_REPLICA_PROMOTE;
  process.env.DTN_REPLICA_PROMOTE = '0';
  try {
    loadBpCodec();
    const cfg = runtime();
    cfg.nodeId = 'Spare';
    cfg.eid = 'ipn:2.3';
    const store = new MemoryStore();
    const graph = new GraphService(cfg);
    graph.markUnhealthy('Earth');
    const contacts = new ContactService(cfg, graph);
    const peer = new PeerService(cfg, graph);
    const bundles = new BundleService(
      cfg,
      store as unknown as LevelStore,
      contacts,
      peer,
      graph,
    );
    await bundles.ingestFromPeer(
      {
        id: 'b-off',
        src: 'Earth',
        dst: 'Mars',
        payload: 'hi',
        payloadSha256: payloadSha256('hi'),
        createdAt: Date.now(),
        ttlMs: 120_000,
        hops: [],
        delivered: false,
      },
      'Earth',
      true,
    );
    const svc = bundles as unknown as { planTick(): Promise<unknown> };
    await svc.planTick();
    const stored = await store.getBundle('b-off');
    assert.equal(stored?.replicaRole, 'replica');
    assert.equal(store.custody.size, 0);
  } finally {
    if (prev === undefined) delete process.env.DTN_REPLICA_PROMOTE;
    else process.env.DTN_REPLICA_PROMOTE = prev;
  }
});

test('does not promote when replicaOf is not unhealthy', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
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
  await bundles.ingestFromPeer(
    {
      id: 'b-live',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      payloadSha256: payloadSha256('hi'),
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
    true,
  );
  const svc = bundles as unknown as { planTick(): Promise<unknown> };
  await svc.planTick();
  const stored = await store.getBundle('b-live');
  assert.equal(stored?.replicaRole, 'replica');
  assert.equal(store.custody.size, 0);
});

test('forwardTo sends x-dtn-payload-sha256 with the bundle hash', async () => {
  const cfg = runtime();
  const peer = new PeerService(cfg);
  const hex = payloadSha256('hi');
  let headers: Record<string, string> | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    headers = init?.headers;
    return new Response(
      JSON.stringify({ accepted: true, delivered: false, event: 'REPLICA_STORE', msg: 'ok' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const result = await peer.forwardTo(
      'http://127.0.0.1:9',
      {
        id: 'b-hdr',
        src: 'Earth',
        dst: 'Mars',
        payload: 'hi',
        payloadSha256: hex,
        createdAt: Date.now(),
        ttlMs: 120_000,
        hops: [],
        delivered: false,
        wire: Buffer.from('wire').toString('base64'),
      },
      { 'x-dtn-replica': '1' },
    );
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(headers?.['x-dtn-replica'], '1');
  assert.equal(headers?.['x-dtn-payload-sha256'], hex);
});

test('destination ingest with bad sha256 is CORRUPT and is not delivered', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Mars';
  cfg.eid = 'ipn:3.1';
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
  const result = await bundles.ingestFromPeer(
    {
      id: 'b-dst-bad',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hj',
      payloadSha256: payloadSha256('hi'),
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
  );
  assert.equal(result.event, 'CORRUPT');
  assert.equal(result.delivered, false);
  assert.equal(store.inbox.length, 0);
  assert.equal(store.custody.size, 0);
  const stored = await store.getBundle('b-dst-bad');
  assert.equal(stored?.delivered, false);
  assert.equal((stored?.events ?? []).some((e) => e.kind === 'CORRUPT'), true);
});

test('promote writes custody before primary so a putBundle failure can retry', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  cfg.role = 'orbiter';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  graph.markUnhealthy('Earth');
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  peer.forwardTo = async (_url, bundle) => ({ ok: true, wireBase64: bundle.wire });
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  const hex = payloadSha256('hi');
  await bundles.ingestFromPeer(
    {
      id: 'b-retry',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      payloadSha256: hex,
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
    true,
  );
  const realPut = store.putBundle.bind(store);
  let failPrimary = true;
  store.putBundle = async (bundle) => {
    if (bundle.replicaRole === 'primary' && failPrimary) {
      failPrimary = false;
      throw new Error('putBundle failed');
    }
    return realPut(bundle);
  };
  const svc = bundles as unknown as { planTick(): Promise<unknown> };
  await assert.rejects(() => svc.planTick(), /putBundle failed/);
  const mid = await store.getBundle('b-retry');
  assert.equal(mid?.replicaRole, 'replica');
  assert.ok(store.custody.has('b-retry'));
  await svc.planTick();
  const stored = await store.getBundle('b-retry');
  assert.equal(stored?.replicaRole, 'primary');
  assert.equal(stored?.custodian, 'Spare');
  assert.ok(store.custody.has('b-retry'));
});

test('promote appends CORRUPT once when a stored replica hash no longer matches', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  graph.markUnhealthy('Earth');
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  await bundles.ingestFromPeer(
    {
      id: 'b-rot',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      payloadSha256: payloadSha256('hi'),
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
    true,
  );
  const good = await store.getBundle('b-rot');
  assert.ok(good);
  await store.putBundle({ ...good, payload: 'hj' });
  const svc = bundles as unknown as { planTick(): Promise<unknown> };
  await svc.planTick();
  const once = await store.getBundle('b-rot');
  assert.equal(once?.replicaRole, 'replica');
  assert.equal(store.custody.size, 0);
  assert.equal((once?.events ?? []).filter((e) => e.kind === 'CORRUPT').length, 1);
  await svc.planTick();
  const twice = await store.getBundle('b-rot');
  assert.equal((twice?.events ?? []).filter((e) => e.kind === 'CORRUPT').length, 1);
});

test('non-replica ingest keeps payloadSha256 on relay and local delivery', async () => {
  loadBpCodec();
  const hex = payloadSha256('hi');
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  cfg.role = 'orbiter';
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
  const base = {
    src: 'Earth',
    payload: 'hi',
    payloadSha256: hex,
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
  };
  await bundles.ingestFromPeer({ ...base, id: 'b-hash', dst: 'Mars' }, 'Earth');
  assert.equal((await store.getBundle('b-hash'))?.payloadSha256, hex);
  await bundles.ingestFromPeer({ ...base, id: 'b-local', dst: 'Spare' }, 'Earth');
  assert.equal((await store.getBundle('b-local'))?.payloadSha256, hex);
});
