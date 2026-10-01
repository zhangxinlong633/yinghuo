import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { RelayController } from '../relay/relay.controller';
import { LevelStore } from '../store/level-store';
import type { CustodyRecord, RelayBundle } from './bundle.types';
import { BundleService } from './bundle.service';
import { decodeBundle, loadBpCodec } from '../bp/bp-codec';

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

function cfg(eidByNode: Record<string, string>): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: eidByNode.Earth ?? 'ipn:1.1',
    eidByNode,
    port: 3101,
    peerUrl: 'http://127.0.0.1:9',
    peers: { Mars: 'http://127.0.0.1:9' },
    role: 'endpoint',
    nextHop: { Mars: 'Mars' },
    graphMode: false,
    x: 0,
    y: 0,
    dataDir: '',
    plan: {
      nodes: [],
      contacts: [
        {
          a: 'Earth',
          b: 'Mars',
          delayMs: 0,
          schedule: {
            type: 'cyclic',
            periodMs: 10_000,
            openOffsetMs: 0,
            openDurationMs: 10_000,
          },
        },
      ],
    },
    planPath: '',
    startedAt: 0,
  };
}

function harness(eidByNode: Record<string, string>) {
  const runtime = cfg(eidByNode);
  const store = new MemoryStore();
  const contacts = new ContactService(runtime);
  const peer = new PeerService(runtime);
  let forwards = 0;
  const forwardTo = peer.forwardTo.bind(peer);
  peer.forwardTo = async (url, bundle) => {
    forwards += 1;
    return forwardTo(url, bundle);
  };
  const bundles = new BundleService(
    runtime,
    store as unknown as LevelStore,
    contacts,
    peer
  );
  const controller = new RelayController(bundles, contacts, runtime);
  return { store, bundles, controller, forwards: () => forwards };
}

test('encode failure on send does not enter FORWARDING', async () => {
  loadBpCodec();
  const { store, bundles, controller, forwards } = harness({
    Earth: 'ipn:1.1',
    Mars: 'dtn:mars',
  });

  const res = await controller.send({ dst: 'Mars', payload: 'hi' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /dtn_bp_encode failed/);

  assert.equal(store.bundles.size, 0);
  assert.equal(store.custody.size, 0);
  assert.equal(forwards(), 0);

  const waiting: RelayBundle = {
    id: 'held-1',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hi',
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
    state: 'WAITING',
    custodian: 'Earth',
    events: [{ t: Date.now(), node: 'Earth', kind: 'STORED', msg: 'persisted' }],
  };
  await store.putBundle(waiting);
  await store.putCustody({
    bundleId: waiting.id,
    waitingAck: false,
    from: null,
    heldAt: waiting.createdAt,
  });

  const svc = bundles as unknown as {
    planTick(): Promise<{ forwards: unknown[] }>;
  };
  const first = await svc.planTick();
  const second = await svc.planTick();
  const stored = await store.getBundle(waiting.id);

  assert.equal(first.forwards.length, 0);
  assert.equal(second.forwards.length, 0);
  assert.equal(forwards(), 0);
  assert.ok(stored);
  assert.notEqual(stored?.state, 'FORWARDING');
  assert.equal(stored?.events?.some((event) => event.kind === 'ENCODE_FAIL'), true);
});

test('successful send stores wire before forward', async () => {
  loadBpCodec();
  const { store, controller } = harness({
    Earth: 'ipn:1.1',
    Mars: 'ipn:3.1',
  });
  let body: Buffer | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: Buffer }) => {
    body = init?.body;
    return new Response(
      JSON.stringify({ accepted: true, delivered: false, event: 'STORE', msg: 'ok' }),
      { status: 201, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const res = await controller.send({ dst: 'Mars', payload: 'hello-wire' });
    assert.equal(res.ok, true);
    assert.ok(body);
    const decoded = decodeBundle(body);
    assert.equal(decoded.payload.toString('utf8'), 'hello-wire');
    assert.equal(decoded.dstEid, 'ipn:3.1');

    const stored = [...store.bundles.values()].map((raw) => JSON.parse(raw) as RelayBundle);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].state, 'FORWARDING');
    assert.equal(stored[0].wire, body.toString('base64'));
  } finally {
    globalThis.fetch = original;
  }
});
