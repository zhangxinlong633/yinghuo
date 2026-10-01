import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import * as fs from 'fs';
import * as path from 'path';
import { ContactPlanJson, SimEvent } from '@dtn-demo/core';

export interface SavedRun {
  id: string;
  createdAt: string;
  success: boolean;
  pending: number;
  storeSizes: Record<string, number>;
  events: SimEvent[];
  plan: ContactPlanJson;
  maxTimeMs: number;
  roles: Record<string, string>;
  summary: string;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  success: boolean;
  pending: number;
  summary: string;
  eventCount: number;
  maxTimeMs: number;
}

/** Prefer apps/api/data/dtn-runs whether cwd is monorepo root or apps/api. */
function resolveDataDir(): string {
  if (process.env.DTN_RUNS_DIR) {
    return path.resolve(process.env.DTN_RUNS_DIR);
  }
  const cwd = process.cwd();
  const underApi = path.join(cwd, 'data', 'dtn-runs');
  const underRoot = path.join(cwd, 'apps', 'api', 'data', 'dtn-runs');
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === '@dtn-demo/api') return underApi;
      if (pkg.name === 'dtn-demo') return underRoot;
    } catch {
      /* fall through */
    }
  }
  if (fs.existsSync(path.join(cwd, 'apps', 'api'))) return underRoot;
  return underApi;
}

@Injectable()
export class RunsStore implements OnModuleInit, OnModuleDestroy {
  private db!: ClassicLevel<string, string>;
  private readonly dataDir = resolveDataDir();

  async onModuleInit(): Promise<void> {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new ClassicLevel(this.dataDir, { valueEncoding: 'utf8' });
    await this.db.open();
    console.log(`LevelDB runs store at ${this.dataDir}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.db && this.db.status === 'open') {
      await this.db.close();
    }
  }

  getDataDir(): string {
    return this.dataDir;
  }

  async save(run: SavedRun): Promise<void> {
    await this.db.put(run.id, JSON.stringify(run));
  }

  async get(id: string): Promise<SavedRun | null> {
    try {
      const raw = await this.db.get(id);
      if (raw == null) return null;
      return JSON.parse(raw) as SavedRun;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'LEVEL_NOT_FOUND') return null;
      throw err;
    }
  }

  async listRecent(limit = 50): Promise<RunSummary[]> {
    const runs: RunSummary[] = [];
    for await (const [, value] of this.db.iterator()) {
      if (value == null) continue;
      const run = JSON.parse(value) as SavedRun;
      runs.push({
        id: run.id,
        createdAt: run.createdAt,
        success: run.success,
        pending: run.pending,
        summary: run.summary,
        eventCount: run.events?.length ?? 0,
        maxTimeMs: run.maxTimeMs,
      });
    }
    runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return runs.slice(0, limit);
  }
}
