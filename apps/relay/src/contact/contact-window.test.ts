import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCyclicOpen } from './contact-window';

const schedule = { periodMs: 30000, openOffsetMs: 0, openDurationMs: 10000 };

test('open at start and closed at duration', () => {
  assert.equal(isCyclicOpen(0, schedule), true);
  assert.equal(isCyclicOpen(9999, schedule), true);
  assert.equal(isCyclicOpen(10000, schedule), false);
  assert.equal(isCyclicOpen(30000, schedule), true);
});
