import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABSOLUTE_EPOCH_FLOOR_MS,
  normalizeAbsoluteWindow,
  normalizeContactPlan,
  normalizeSchedule,
} from './contact-plan-normalize';

const base = 1_700_000_000_000;

test('offset fields resolve against baseMs', () => {
  const w = normalizeAbsoluteWindow({ offsetStartMs: 1000, offsetEndMs: 5000 }, base);
  assert.deepEqual(w, { startMs: base + 1000, endMs: base + 5000 });
});

test('small startMs treated as offset from base', () => {
  assert.ok(0 < ABSOLUTE_EPOCH_FLOOR_MS);
  const w = normalizeAbsoluteWindow({ startMs: 0, endMs: 60_000 }, base);
  assert.deepEqual(w, { startMs: base, endMs: base + 60_000 });
});

test('epoch startMs left untouched', () => {
  const start = base + 10_000;
  const end = base + 20_000;
  assert.deepEqual(normalizeAbsoluteWindow({ startMs: start, endMs: end }, 0), {
    startMs: start,
    endMs: end,
  });
});

test('normalizeSchedule sorts and drops empty windows', () => {
  const s = normalizeSchedule(
    {
      type: 'absolute',
      windows: [
        { startMs: 20_000, endMs: 25_000 },
        { startMs: 1000, endMs: 1000 },
        { startMs: 0, endMs: 5000 },
      ],
    },
    base,
  );
  assert.equal(s.type, 'absolute');
  if (s.type === 'absolute') {
    assert.deepEqual(s.windows, [
      { startMs: base, endMs: base + 5000 },
      { startMs: base + 20_000, endMs: base + 25_000 },
    ]);
  }
});

test('normalizeContactPlan rewrites contact schedules', () => {
  const plan = normalizeContactPlan(
    {
      nodes: [],
      contacts: [
        {
          a: 'Earth',
          b: 'Relay',
          delayMs: 100,
          schedule: {
            type: 'absolute',
            windows: [{ offsetStartMs: 0, offsetEndMs: 10_000 }],
          },
        },
      ],
    },
    base,
  );
  const sch = plan.contacts[0]!.schedule;
  assert.equal(sch.type, 'absolute');
  if (sch.type === 'absolute') {
    assert.deepEqual(sch.windows[0], { startMs: base, endMs: base + 10_000 });
  }
});

test('cyclic schedules get explicit type', () => {
  const s = normalizeSchedule(
    { periodMs: 30_000, openOffsetMs: 0, openDurationMs: 10_000 },
    base,
  );
  assert.deepEqual(s, {
    type: 'cyclic',
    periodMs: 30_000,
    openOffsetMs: 0,
    openDurationMs: 10_000,
  });
});
