import * as fs from 'fs';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PlanStatus } from '../bundle/bundle.types';
import {
  applyContactPlanToConfig,
  markPlanLoadError,
  planWatchEnabled,
  type RelayRuntimeConfig,
} from '../config';
import { interpolateEnv } from '../config/env-interpolate';
import { RELAY_CONFIG } from '../relay.tokens';
import { ContactService } from './contact.service';

export type PlanReloadResult =
  | { ok: true; version: string; source: PlanStatus['source'] }
  | { ok: false; errors: string[]; source: PlanStatus['source'] };

@Injectable()
export class ContactPlanReloadService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ContactPlanReloadService.name);
  private watcher?: fs.FSWatcher;
  private debounce?: ReturnType<typeof setTimeout>;
  private lastAppliedVersion = '';

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Inject(ContactService) private readonly contacts: ContactService,
  ) {
    this.lastAppliedVersion = cfg.planStatus.version;
  }

  onModuleInit(): void {
    if (!planWatchEnabled()) {
      this.log.log('plan file watch disabled (DTN_PLAN_WATCH=0)');
      return;
    }
    try {
      this.watcher = fs.watch(this.cfg.planPath, () => this.scheduleWatchReload());
      this.log.log(`watching contact plan ${this.cfg.planPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`plan watch failed: ${msg}`);
      this.cfg.planStatus.watchEnabled = false;
    }
  }

  onModuleDestroy(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
  }

  getStatus(): PlanStatus {
    return { ...this.cfg.planStatus, path: this.cfg.planPath };
  }

  /** Reload from disk (HTTP or watch). */
  reloadFromDisk(source: 'watch' | 'http' = 'http'): PlanReloadResult {
    let rawText: string;
    try {
      rawText = interpolateEnv(fs.readFileSync(this.cfg.planPath, 'utf8'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errors = [`failed to read ${this.cfg.planPath}: ${msg}`];
      markPlanLoadError(this.cfg, errors);
      return { ok: false, errors, source };
    }
    return this.applyRaw(rawText, source);
  }

  /** Apply a JSON body (HTTP push). Does not write disk. */
  reloadFromBody(body: unknown, rawText?: string): PlanReloadResult {
    const text = rawText ?? JSON.stringify(body);
    return this.applyRaw(text, 'http', body);
  }

  private scheduleWatchReload(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      const result = this.reloadFromDisk('watch');
      if (result.ok) {
        if (result.version !== this.lastAppliedVersion) {
          this.log.log(`plan reloaded from watch version=${result.version}`);
        }
      } else {
        this.log.warn(`plan watch reload failed: ${result.errors.join('; ')}`);
      }
    }, 400);
  }

  private applyRaw(rawText: string, source: PlanStatus['source'], preParsed?: unknown): PlanReloadResult {
    let raw: unknown = preParsed;
    if (raw === undefined) {
      try {
        raw = JSON.parse(rawText);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const errors = [`invalid JSON: ${msg}`];
        markPlanLoadError(this.cfg, errors);
        return { ok: false, errors, source };
      }
    }

    const applied = applyContactPlanToConfig(this.cfg, raw, rawText, source);
    if (!applied.ok) {
      markPlanLoadError(this.cfg, applied.errors);
      return { ok: false, errors: applied.errors, source };
    }

    try {
      this.contacts.replacePlanContacts(applied.plan.contacts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errors = [msg];
      markPlanLoadError(this.cfg, errors);
      return { ok: false, errors, source };
    }

    this.lastAppliedVersion = applied.version;
    return { ok: true, version: applied.version, source };
  }
}
