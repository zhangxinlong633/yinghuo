import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  ContactPlanJson,
  Simulator,
  SimEvent,
  defaultContactPlan,
} from '@dtn-demo/core';
import { RunsStore, RunSummary, SavedRun } from './runs.store';

export interface SimulateResult {
  success: boolean;
  pending: number;
  storeSizes: Record<string, number>;
  events: SimEvent[];
  plan: ContactPlanJson;
  maxTimeMs: number;
  runId: string;
}

@Injectable()
export class DtnService {
  constructor(@Inject(RunsStore) private readonly runs: RunsStore) {}

  getPlan(): ContactPlanJson {
    return this.loadPlanFile() ?? { ...defaultContactPlan };
  }

  getNodes(): Array<{
    name: string;
    nextHop: Record<string, string>;
    role?: 'endpoint' | 'relay' | 'hybrid';
  }> {
    return this.getPlan().nodes.map((n) => ({
      name: n.name,
      nextHop: n.nextHop,
      role: n.role ?? 'hybrid',
    }));
  }

  getContacts() {
    return this.getPlan().contacts;
  }

  async simulate(override?: Partial<ContactPlanJson>): Promise<SimulateResult> {
    const base = this.getPlan();
    const plan: ContactPlanJson = {
      ...base,
      ...override,
      nodes: override?.nodes ?? base.nodes,
      contacts: override?.contacts ?? base.contacts,
      application: {
        ...base.application!,
        ...override?.application,
      },
    };

    const sim = new Simulator();
    sim.quiet = true;
    sim.loadContactPlan(plan);

    const app = plan.application ?? defaultContactPlan.application!;
    sim.schedule(app.atMs ?? 0, () =>
      sim.send(app.src, app.dst, app.payload, app.ttlMs ?? 10000)
    );

    const maxTimeMs = plan.maxTimeMs ?? 5000;
    await sim.run(maxTimeMs, plan.tickMs ?? 100);

    const storeSizes: Record<string, number> = {};
    let pending = 0;
    for (const [name, node] of sim.nodes) {
      storeSizes[name] = node.store.size;
      pending += node.store.size;
    }

    const success = pending === 0;
    const roles: Record<string, string> = {};
    for (const n of plan.nodes) {
      roles[n.name] = n.role ?? 'hybrid';
    }

    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    const planName = plan.description?.slice(0, 80) ?? 'default-plan';
    const summary = `${success ? 'OK' : 'FAIL'} · ${app.src}→${app.dst} · ${
      sim.events.length
    } events · ${planName}`;

    const saved: SavedRun = {
      id,
      createdAt,
      success,
      pending,
      storeSizes,
      events: sim.events,
      plan,
      maxTimeMs,
      roles,
      summary,
    };
    await this.runs.save(saved);

    return {
      success,
      pending,
      storeSizes,
      events: sim.events,
      plan,
      maxTimeMs,
      runId: id,
    };
  }

  async listRuns(limit = 50): Promise<RunSummary[]> {
    return this.runs.listRecent(limit);
  }

  async getRun(id: string): Promise<SavedRun | null> {
    return this.runs.get(id);
  }

  private loadPlanFile(): ContactPlanJson | null {
    const candidates = [
      path.resolve(process.cwd(), 'k8s/contact-plan.json'),
      path.resolve(process.cwd(), '../../k8s/contact-plan.json'),
      path.resolve(__dirname, '../../../../k8s/contact-plan.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return JSON.parse(fs.readFileSync(c, 'utf8')) as ContactPlanJson;
      }
    }
    return null;
  }
}
