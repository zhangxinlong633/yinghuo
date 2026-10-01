import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DualContactPlan } from '../bundle/bundle.types';
import {
  applyContactPlanToConfig,
  loadRelayConfig,
  markPlanLoadError,
  resetSharedRelayConfigForTests,
  type RelayRuntimeConfig,
} from '../config';
import { ContactService } from './contact.service';
import { isContactOpen } from './contact-window';

function baseCfg(partial: Partial<RelayRuntimeConfig> = {}): RelayRuntimeConfig {
  const plan: DualContactPlan = {
    nodes: [
      { name: 'Earth', role: 'ground', port: 3101, peerUrl: 'http://127.0.0.1:3103' },
      { name: 'Relay', role: 'orbiter', port: 3103, peerUrl: 'http://127.0.0.1:3101' },
    ],
    contacts: [
      {
        a: 'Earth',
        b: 'Relay',
        delayMs: 100,
        schedule: { type: 'cyclic', periodMs: 30_000, openOffsetMs: 0, openDurationMs: 10_000 },
      },
    ],
  };
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Relay: 'ipn:2.1' },
    roleByNode: { Earth: 'ground', Relay: 'orbiter' },
    port: 3101,
    peerUrl: 'http://127.0.0.1:3103',
    peers: { Relay: 'http://127.0.0.1:3103' },
    role: 'ground',
    nextHop: { Mars: 'Relay' },
    dataDir: '',
    plan,
    planPath: '/tmp/plan.json',
    planStatus: {
      path: '/tmp/plan.json',
      version: 'boot',
      loadedAt: 1,
      source: 'boot',
      ok: true,
      lastError: null,
      lastFailedAt: null,
      watchEnabled: false,
    },
    startedAt: 1_700_000_000_000,
    graphMode: false,
    x: 0,
    y: 0,
    ...partial,
  };
}

test('applyContactPlanToConfig updates schedules using original startedAt', () => {
  const cfg = baseCfg();
  const raw = {
    nodes: cfg.plan.nodes,
    contacts: [
      {
        a: 'Earth',
        b: 'Relay',
        delayMs: 999,
        schedule: {
          type: 'absolute',
          windows: [{ offsetStartMs: 0, offsetEndMs: 5_000 }],
        },
      },
    ],
  };
  const text = JSON.stringify(raw);
  const result = applyContactPlanToConfig(cfg, raw, text, 'http');
  assert.equal(result.ok, true);
  assert.equal(cfg.plan.contacts[0]!.delayMs, 999);
  const sch = cfg.plan.contacts[0]!.schedule;
  assert.equal(sch.type, 'absolute');
  if (sch.type === 'absolute') {
    assert.equal(sch.windows[0]!.startMs, cfg.startedAt);
    assert.equal(sch.windows[0]!.endMs, cfg.startedAt + 5_000);
  }
  assert.equal(cfg.planStatus.source, 'http');
  assert.equal(cfg.planStatus.ok, true);
});

test('bad plan leaves previous plan intact', () => {
  const cfg = baseCfg();
  const before = cfg.plan.contacts[0]!.delayMs;
  const result = applyContactPlanToConfig(cfg, { nodes: [], contacts: [] }, '{}', 'http');
  assert.equal(result.ok, false);
  assert.equal(cfg.plan.contacts[0]!.delayMs, before);
  markPlanLoadError(cfg, result.ok === false ? result.errors : ['x']);
  assert.equal(cfg.planStatus.ok, false);
  assert.ok(cfg.planStatus.lastError);
});

test('ContactService.replacePlanContacts switches open window', () => {
  const cfg = baseCfg();
  const contacts = new ContactService(cfg);
  assert.equal(isContactOpen(0, contacts.getState(0).schedule), true);

  contacts.replacePlanContacts([
    {
      a: 'Earth',
      b: 'Relay',
      delayMs: 1,
      schedule: { type: 'cyclic', periodMs: 30_000, openOffsetMs: 20_000, openDurationMs: 5_000 },
    },
  ]);
  assert.equal(contacts.getState(0).open, false);
  assert.equal(contacts.getState(20_000).open, true);
  assert.equal(contacts.delayMs(), 1);
});

test('loadRelayConfig sets planStatus on boot', () => {
  resetSharedRelayConfigForTests();
  const prev = process.env.CONTACT_PLAN;
  process.env.CONTACT_PLAN = require('path').join(__dirname, '..', '..', 'contact-plan.tri.json');
  try {
    const cfg = loadRelayConfig();
    assert.equal(cfg.planStatus.source, 'boot');
    assert.equal(cfg.planStatus.ok, true);
    assert.ok(cfg.planStatus.version.length >= 8);
  } finally {
    if (prev === undefined) delete process.env.CONTACT_PLAN;
    else process.env.CONTACT_PLAN = prev;
    resetSharedRelayConfigForTests();
  }
});
