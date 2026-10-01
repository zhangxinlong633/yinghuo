import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCyclicOpen, msUntilOpen } from './contact-window';

const schedule = { periodMs: 30000, openOffsetMs: 0, openDurationMs: 10000 };

test('msUntilOpen is zero when open and positive until next window', () => {
  const openAtStart = { periodMs: 60000, openOffsetMs: 5000, openDurationMs: 10000 };
  assert.equal(msUntilOpen(0, openAtStart), 5000);
  assert.equal(msUntilOpen(5000, openAtStart), 0);
  assert.equal(msUntilOpen(15000, openAtStart), 50000);
});

test('open at start and closed at duration', () => {
  assert.equal(isCyclicOpen(0, schedule), true);
  assert.equal(isCyclicOpen(9999, schedule), true);
  assert.equal(isCyclicOpen(10000, schedule), false);
  assert.equal(isCyclicOpen(30000, schedule), true);
});
