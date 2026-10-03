import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CustodyRecord, RelayBundle } from './bundle.types';
import { BundleService } from './bundle.service';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { PeerService } from '../peer/peer.service';
import { LevelStore } from '../store/level-store';
import { GraphService } from '../graph/graph.service';

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
    startedAt: Date.now(),
  };
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
  return { bundles };
}

describe('status region and tier', { concurrency: 1 }, () => {
  test('region is null when DTN_REGION unset', async () => {
    await withEnv({ DTN_REGION: undefined, DTN_TIER: undefined }, async () => {
      const { bundles } = harness();
      const status = await bundles.status();
      assert.equal(status.region, null);
      assert.equal(status.tier, 'edge');
    });
  });

  test('region reflects DTN_REGION', async () => {
    await withEnv({ DTN_REGION: 'earth', DTN_TIER: undefined }, async () => {
      const { bundles } = harness();
      const status = await bundles.status();
      assert.equal(status.region, 'earth');
      assert.equal(status.tier, 'edge');
    });
  });
});
