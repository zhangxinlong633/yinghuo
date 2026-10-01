import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import * as fs from 'fs';
import * as path from 'path';
import type { CustodyRecord, DeliveredMessage, RelayBundle } from '../bundle/bundle.types';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';
import { Inject } from '@nestjs/common';

@Injectable()
export class LevelStore implements OnModuleInit, OnModuleDestroy {
  private bundlesDb!: ClassicLevel<string, string>;
  private custodyDb!: ClassicLevel<string, string>;
  private indexDb!: ClassicLevel<string, string>;
  /** In-memory delivery inbox for local CLI/SDK poll (also mirrored in index). */
  private inbox: DeliveredMessage[] = [];

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {}

  async onModuleInit(): Promise<void> {
    const base = this.cfg.dataDir;
    fs.mkdirSync(path.join(base, 'bundles'), { recursive: true });
    fs.mkdirSync(path.join(base, 'custody'), { recursive: true });
    fs.mkdirSync(path.join(base, 'index'), { recursive: true });
    this.bundlesDb = new ClassicLevel(path.join(base, 'bundles'), { valueEncoding: 'utf8' });
    this.custodyDb = new ClassicLevel(path.join(base, 'custody'), { valueEncoding: 'utf8' });
    this.indexDb = new ClassicLevel(path.join(base, 'index'), { valueEncoding: 'utf8' });
    await Promise.all([this.bundlesDb.open(), this.custodyDb.open(), this.indexDb.open()]);
    await this.loadInboxFromIndex();
    const c = await this.counts();
    console.log(
      `LevelDB triple store under ${base} (bundles=${c.bundles} custody=${c.custody} index=${c.index} inbox=${c.inbox})`
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const db of [this.bundlesDb, this.custodyDb, this.indexDb]) {
      if (db && db.status === 'open') await db.close();
    }
  }

  getDataDir(): string {
    return this.cfg.dataDir;
  }

  private async loadInboxFromIndex(): Promise<void> {
    this.inbox = [];
    for await (const [key, value] of this.indexDb.iterator({ gte: 'inbox:', lt: 'inbox;' })) {
      if (!value) continue;
      void key;
      this.inbox.push(JSON.parse(value) as DeliveredMessage);
    }
    this.inbox.sort((a, b) => a.deliveredAt - b.deliveredAt);
  }

  async putBundle(bundle: RelayBundle): Promise<void> {
    await this.bundlesDb.put(bundle.id, JSON.stringify(bundle));
    await this.indexDb.put(`bundle:${bundle.id}`, bundle.dst);
    await this.indexDb.put(`pending:${bundle.id}`, bundle.dst);
  }

  async getBundle(id: string): Promise<RelayBundle | null> {
    try {
      const raw = await this.bundlesDb.get(id);
      return raw ? (JSON.parse(raw) as RelayBundle) : null;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'LEVEL_NOT_FOUND') return null;
      throw err;
    }
  }

  async deleteBundle(id: string): Promise<void> {
    try {
      await this.bundlesDb.del(id);
    } catch {
      /* ignore */
    }
    try {
      await this.indexDb.del(`bundle:${id}`);
    } catch {
      /* ignore */
    }
    try {
      await this.indexDb.del(`pending:${id}`);
    } catch {
      /* ignore */
    }
  }

  async putCustody(rec: CustodyRecord): Promise<void> {
    await this.custodyDb.put(rec.bundleId, JSON.stringify(rec));
  }

  async getCustody(id: string): Promise<CustodyRecord | null> {
    try {
      const raw = await this.custodyDb.get(id);
      return raw ? (JSON.parse(raw) as CustodyRecord) : null;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'LEVEL_NOT_FOUND') return null;
      throw err;
    }
  }

  async releaseCustody(id: string): Promise<void> {
    try {
      await this.custodyDb.del(id);
    } catch {
      /* ignore */
    }
    try {
      await this.indexDb.del(`pending:${id}`);
    } catch {
      /* ignore */
    }
  }

  async listPendingBundleIds(): Promise<string[]> {
    const ids: string[] = [];
    for await (const key of this.custodyDb.keys()) {
      ids.push(key);
    }
    return ids;
  }

  /** Every stored bundle id, including ones touched before this process started. */
  async listBundleIds(): Promise<string[]> {
    const ids: string[] = [];
    for await (const key of this.bundlesDb.keys()) {
      ids.push(key);
    }
    return ids;
  }

  async deliverLocal(msg: DeliveredMessage): Promise<void> {
    this.inbox.push(msg);
    await this.indexDb.put(`inbox:${msg.id}`, JSON.stringify(msg));
  }

  /** Poll and optionally clear delivered messages. */
  pollInbox(clear = true): DeliveredMessage[] {
    const out = [...this.inbox];
    if (clear) {
      this.inbox = [];
      // async clear of index keys — fire and forget
      void (async () => {
        for (const m of out) {
          try {
            await this.indexDb.del(`inbox:${m.id}`);
          } catch {
            /* ignore */
          }
        }
      })();
    }
    return out;
  }

  peekInbox(): DeliveredMessage[] {
    return [...this.inbox];
  }

  /** Drop one locally delivered payload. Expired bundles must not stay readable. */
  dropInbox(id: string): void {
    this.inbox = this.inbox.filter((m) => m.id !== id);
    const db = this.indexDb;
    if (!db || db.status !== 'open') return;
    void db.del(`inbox:${id}`).catch(() => undefined);
  }

  /** Count keys via keys() iterator (values skipped); close iterator explicitly. */
  private async countKeys(db: ClassicLevel<string, string>): Promise<number> {
    let n = 0;
    const it = db.keys();
    try {
      for await (const _k of it) {
        n++;
      }
    } finally {
      try {
        await it.close();
      } catch {
        /* already closed by for-await */
      }
    }
    return n;
  }

  async counts(): Promise<{ bundles: number; custody: number; index: number; inbox: number }> {
    const [bundles, custody, index] = await Promise.all([
      this.countKeys(this.bundlesDb),
      this.countKeys(this.custodyDb),
      this.countKeys(this.indexDb),
    ]);
    return { bundles, custody, index, inbox: this.inbox.length };
  }
}
