import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatUnhealthyLine,
  planKeepOldMessage,
  shortPlanVersion,
} from './console-trust-format.ts';

test('shortPlanVersion truncates long hashes', () => {
  assert.equal(shortPlanVersion('abcdefghijklmnop', 12), 'abcdefghijkl');
  assert.equal(shortPlanVersion('abcd', 12), 'abcd');
  assert.equal(shortPlanVersion('', 12), '—');
});

test('formatUnhealthyLine includes id and remain seconds', () => {
  assert.equal(formatUnhealthyLine({ id: 'Near', remainMs: 4500 }), 'Near · 5s');
  assert.equal(formatUnhealthyLine({ id: 'Alt' }), 'Alt');
});

test('planKeepOldMessage bilingual', () => {
  assert.match(planKeepOldMessage('zh'), /旧计划/);
  assert.match(planKeepOldMessage('en'), /previous plan/i);
});
