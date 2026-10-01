import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBpCodec } from '../bp/bp-codec';
import type { CustodyRecord, RelayBundle } from '../bundle/bundle.types';
import { BundleService } from '../bundle/bundle.service';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { DEFAULT_JOIN_SCHEDULE, GraphService } from './graph.service';

class MemoryStore {
  bundles = new Map<string, string>();
  custody = new Map<string, string>();

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

  dropInbox(): void {}

  peekInbox(): [] {
    return [];
  }
}

function runtime(graphMode: boolean): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Mars: 'ipn:3.1', Pluto: 'ipn:9.1' },
    port: 3101,
    peerUrl: 'http://127.0.0.1:9',
    peers: { Near: 'http://127.0.0.1:9' },
    role: 'endpoint',
    nextHop: { Pluto: 'Near', Mars: 'Near' },
    graphMode,
    x: 0,
    y: 0,
    dataDir: '',
    plan: {
      nodes: [],
      contacts: graphMode
        ? []
        : [
            {
              a: 'Earth',
              b: 'Near',
              delayMs: 0,
              schedule: DEFAULT_JOIN_SCHEDULE,
            },
          ],
    },
    planPath: '',
    startedAt: 0,
  };
}

function seed(graph: GraphService): void {
  graph.upsertDirectPeer(
    'Near',
    'http://127.0.0.1:9',
    { id: 'Near', eid: 'ipn:2.1', x: 3, y: 0 },
    DEFAULT_JOIN_SCHEDULE,
  );
  graph.upsertDirectPeer(
    'Far',
    'http://127.0.0.1:8',
    { id: 'Far', eid: 'ipn:2.2', x: -4, y: 0 },
    DEFAULT_JOIN_SCHEDULE,
  );
}

function harness(graphMode: boolean) {
  const cfg = runtime(graphMode);
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  seed(graph);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  let forwards = 0;
  let forwardImpl = async (
    _url: string,
    bundle: RelayBundle,
  ): Promise<{ ok: boolean; error?: string; wireBase64?: string }> => {
    forwards += 1;
    return { ok: false, error: 'down', wireBase64: bundle.wire };
  };
  peer.forwardTo = (url, bundle) => forwardImpl(url, bundle);
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  return {
    store,
    graph,
    bundles,
    forwards: () => forwards,
    setForward(
      impl: (
        url: string,
        bundle: RelayBundle,
      ) => Promise<{ ok: boolean; error?: string; wireBase64?: string }>,
    ) {
      forwardImpl = impl;
    },
  };
}

test('unknown dst coords stay WAITING and do not enter FORWARDING', async () => {
  loadBpCodec();
  const { store, bundles, forwards } = harness(true);

  const bundle = await bundles.send('Pluto', 'hi');

  assert.equal(forwards(), 0);
  assert.notEqual(bundle.state, 'FORWARDING');
  assert.equal(bundle.state, 'WAITING');
  const route = (bundle.events ?? []).find((event) => event.kind === 'ROUTE');
  assert.equal(route?.msg, 'destination not in local graph');
  const stored = await store.getBundle(bundle.id);
  assert.equal(stored?.state, 'WAITING');
});

test('graph mode records selected and culled neighbors then forwards', async () => {
  loadBpCodec();
  const { graph, bundles, setForward } = harness(true);
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });
  let next = '';
  setForward(async (_url, bundle) => {
    next = bundle.hops.at(-1)?.to ?? '';
    return { ok: true, wireBase64: bundle.wire };
  });

  const bundle = await bundles.send('Mars', 'hi');
  assert.equal(next, 'Near');
  assert.equal(bundle.state, 'FORWARDING');
  const route = (bundle.events ?? []).find((event) => event.kind === 'ROUTE');
  assert.match(route?.msg ?? '', /selected Near/);
  assert.match(route?.msg ?? '', /culled Far/);
});

test('forward failure marks the chosen next hop unhealthy', async () => {
  loadBpCodec();
  const { graph, bundles } = harness(true);
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });

  await bundles.send('Mars', 'hi');

  const after = graph.decide('Mars', Date.now());
  assert.equal(after.nextHop, null);
  assert.equal(after.reason, 'no closer neighbor');
});

test('join-only peer URL is used when it is absent from cfg.peers', async () => {
  loadBpCodec();
  const cfg = runtime(true);
  cfg.peers = {};
  cfg.peerUrl = 'http://127.0.0.1:1';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  graph.upsertDirectPeer(
    'Near',
    'http://127.0.0.1:4102',
    { id: 'Near', eid: 'ipn:2.1', x: 3, y: 0 },
    DEFAULT_JOIN_SCHEDULE,
  );
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  let url = '';
  peer.forwardTo = async (hopUrl, bundle) => {
    url = hopUrl;
    return { ok: true, wireBase64: bundle.wire };
  };
  const bundles = new BundleService(cfg, store as unknown as LevelStore, contacts, peer, graph);

  await bundles.send('Mars', 'hi');
  assert.equal(url, 'http://127.0.0.1:4102');
  assert.equal(peer.urlFor('Near'), 'http://127.0.0.1:4102');
});

test('static nextHop is unchanged when graphMode is off', async () => {
  loadBpCodec();
  const { graph, bundles, setForward } = harness(false);
  graph.ingestSummary({
    from: 'Near',
    nodes: [{ id: 'Mars', eid: 'ipn:3.1', x: 10, y: 0 }],
    edges: [],
  });
  let next = '';
  setForward(async (_url, bundle) => {
    next = bundle.hops.at(-1)?.to ?? '';
    return { ok: false, error: 'down' };
  });

  const bundle = await bundles.send('Mars', 'hi');
  assert.equal(next, 'Near');
  assert.equal(bundle.state, 'WAITING');
  assert.equal(
    (bundle.events ?? []).some((event) => event.kind === 'ROUTE'),
    false,
  );
  assert.equal(graph.decide('Mars', Date.now()).nextHop, 'Near');
});
