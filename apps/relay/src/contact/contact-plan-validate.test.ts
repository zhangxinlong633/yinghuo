import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateContactPlan } from './contact-plan-validate';

const good = {
  nodes: [
    { name: 'Earth', role: 'ground', port: 3101, peerUrl: 'http://127.0.0.1:3103' },
    { name: 'Relay', role: 'orbiter', port: 3103, peerUrl: 'http://127.0.0.1:3102' },
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

test('accepts a minimal cyclic plan', () => {
  const r = validateContactPlan(good, { nodeId: 'Earth', graphMode: false });
  assert.equal(r.ok, true);
});

test('rejects missing local node and contact', () => {
  const r = validateContactPlan(good, { nodeId: 'Mars', graphMode: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('Mars')));
  }
});

test('graph mode allows node absent from plan', () => {
  const r = validateContactPlan({ nodes: [], contacts: [] }, { nodeId: 'Probe', graphMode: true });
  assert.equal(r.ok, true);
});

test('rejects bad absolute window', () => {
  const r = validateContactPlan(
    {
      nodes: good.nodes,
      contacts: [
        {
          a: 'Earth',
          b: 'Relay',
          delayMs: 1,
          schedule: { type: 'absolute', windows: [{ startMs: 10, endMs: 5 }] },
        },
      ],
    },
    { nodeId: 'Earth', graphMode: false },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes('end must be')));
});

test('rejects unknown role', () => {
  const r = validateContactPlan(
    {
      nodes: [{ name: 'Earth', role: 'spaceship', port: 1, peerUrl: 'x' }],
      contacts: good.contacts,
    },
    { nodeId: 'Earth', graphMode: false },
  );
  assert.equal(r.ok, false);
});
