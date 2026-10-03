import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bpsecIngestOk } from './bpsec';

test('bpsec off accepts any header', () => {
  assert.equal(bpsecIngestOk(undefined, {}), true);
});

test('bpsec on requires integrity marker', () => {
  const env = { DTN_BPSEC: '1' };
  assert.equal(bpsecIngestOk(undefined, env), false);
  assert.equal(bpsecIngestOk('integrity', env), true);
  assert.equal(bpsecIngestOk('nope', env), false);
});
