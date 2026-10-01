import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDurationMs,
  isContactOpen,
  isCyclicOpen,
  msUntilClose,
  msUntilOpen,
} from './contact-window';

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

test('msUntilClose is zero when closed and positive while open', () => {
  assert.equal(msUntilClose(0, schedule), 10000);
  assert.equal(msUntilClose(5000, schedule), 5000);
  assert.equal(msUntilClose(10000, schedule), 0);
  assert.equal(msUntilClose(20000, schedule), 0);
});

test('formatDurationMs uses h/m/s for long contact arcs', () => {
  assert.equal(formatDurationMs(0), '0s');
  assert.equal(formatDurationMs(1500), '2s');
  assert.equal(formatDurationMs(65_000), '1m 5s');
  assert.equal(formatDurationMs(3_726_000), '1h 2m 6s');
  assert.equal(formatDurationMs(30_000), '30s');
});

const abs = {
  type: 'absolute' as const,
  windows: [
    { startMs: 1000, endMs: 5000 },
    { startMs: 20_000, endMs: 25_000 },
  ],
};

test('absolute schedule open only inside listed windows', () => {
  assert.equal(isContactOpen(500, abs), false);
  assert.equal(isContactOpen(1000, abs), true);
  assert.equal(isContactOpen(4999, abs), true);
  assert.equal(isContactOpen(5000, abs), false);
  assert.equal(isContactOpen(20_000, abs), true);
});

test('absolute msUntilOpen/Close across gaps', () => {
  assert.equal(msUntilOpen(500, abs), 500);
  assert.equal(msUntilOpen(1000, abs), 0);
  assert.equal(msUntilClose(1000, abs), 4000);
  assert.equal(msUntilClose(6000, abs), 0);
  assert.equal(msUntilOpen(6000, abs), 14_000);
  assert.equal(msUntilOpen(30_000, abs), Number.POSITIVE_INFINITY);
});
