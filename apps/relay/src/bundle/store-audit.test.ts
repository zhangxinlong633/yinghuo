import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CustodyRecord, RelayBundle } from './bundle.types';
import { BundleService } from './bundle.service';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { GraphService } from '../graph/graph.service';
import { payloadSha256 } from './payload-hash';

class MemoryStore {
  bundles = new Map<string, string>();
  custody = new Map<string, string>();
  inbox: Array<{ id: string }> = [];

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

  async deliverLocal(msg: { id: string }): Promise<void> {
    this.inbox.push(msg);
  }

  dropInbox(id?: string): void {
    if (id) this.inbox = this.inbox.filter((m) => m.id !== id);
    else this.inbox = [];
  }

  peekInbox(): Array<{ id: string }> {
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
    nextHop: {},
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

function harness() {
  const cfg = runtime();
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg);
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  const svc = bundles as unknown as {
    auditStoredBundles(): Promise<{ corrupt: number; expired: number }>;
  };
  return { store, svc };
}

test('boot audit marks corrupt payload and skips legacy bundles without hash', async () => {
  const { store, svc } = harness();
  const hex = payloadSha256('hi');
  await store.putBundle({
    id: 'bad',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hj',
    payloadSha256: hex,
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
    state: 'WAITING',
  });
  await store.putBundle({
    id: 'old',
    src: 'Earth',
    dst: 'Mars',
    payload: 'x',
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
    state: 'WAITING',
  });
  const result = await svc.auditStoredBundles();
  assert.equal(result.corrupt, 1);
  assert.equal(result.expired, 0);
  const bad = await store.getBundle('bad');
  const old = await store.getBundle('old');
  assert.equal((bad?.events ?? []).some((e) => e.kind === 'CORRUPT'), true);
  assert.equal((old?.events ?? []).some((e) => e.kind === 'CORRUPT'), false);
});

test('boot audit expires TTL and drops corrupt inbox delivery', async () => {
  const { store, svc } = harness();
  await store.putBundle({
    id: 'dead',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hi',
    payloadSha256: payloadSha256('hi'),
    createdAt: Date.now() - 200_000,
    ttlMs: 120_000,
    hops: [],
    delivered: false,
    state: 'WAITING',
  });
  await store.putCustody({
    bundleId: 'dead',
    waitingAck: false,
    from: null,
    heldAt: Date.now() - 200_000,
  });
  await store.putBundle({
    id: 'inbox-bad',
    src: 'Earth',
    dst: 'Earth',
    payload: 'no',
    payloadSha256: payloadSha256('hi'),
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: true,
    state: 'ARRIVED',
  });
  store.inbox.push({ id: 'inbox-bad' });

  const result = await svc.auditStoredBundles();
  assert.equal(result.expired, 1);
  assert.equal(result.corrupt, 1);
  const dead = await store.getBundle('dead');
  assert.equal(dead?.state, 'EXPIRED');
  assert.equal(store.custody.has('dead'), false);
  assert.equal(store.inbox.some((m) => m.id === 'inbox-bad'), false);
});
