import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payloadHashOk, payloadSha256 } from './payload-hash';

test('sha256 of hi matches known hex', () => {
  assert.equal(
    payloadSha256('hi'),
    '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
  );
});

test('ok when expected matches; fail when one char changes', () => {
  const hex = payloadSha256('hi');
  assert.equal(payloadHashOk('hi', hex), true);
  assert.equal(payloadHashOk('hj', hex), false);
});

test('missing expected hash is treated as ok (legacy)', () => {
  assert.equal(payloadHashOk('hi'), true);
  assert.equal(payloadHashOk('hi', ''), true);
});
