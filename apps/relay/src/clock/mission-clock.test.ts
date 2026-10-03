import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeMissionClock, missionNow } from './mission-clock';

test('missionNow equals wall when epoch unset', () => {
  assert.equal(missionNow(1_700_000_000_000, {}), 1_700_000_000_000);
});

test('missionNow is wall minus MISSION_EPOCH_MS', () => {
  assert.equal(
    missionNow(1_700_000_100_000, { MISSION_EPOCH_MS: '1700000000000' }),
    100_000,
  );
});

test('MISSION_CLOCK_OFFSET_MS shifts wall when no epoch', () => {
  assert.equal(
    missionNow(1_000, { MISSION_CLOCK_OFFSET_MS: '250' }),
    1_250,
  );
});

test('epoch wins over offset', () => {
  assert.equal(
    missionNow(5_000, { MISSION_EPOCH_MS: '1000', MISSION_CLOCK_OFFSET_MS: '99999' }),
    4_000,
  );
});

test('describeMissionClock exposes both clocks', () => {
  const d = describeMissionClock(10_000, { MISSION_EPOCH_MS: '1000' });
  assert.equal(d.wallMs, 10_000);
  assert.equal(d.missionMs, 9_000);
  assert.equal(d.epochMs, 1_000);
});
