import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinTokenHeaders, joinTokenOk } from './join-token';

test('open join when token unset', () => {
  assert.equal(joinTokenOk(undefined, {}), true);
  assert.equal(joinTokenOk('x', {}), true);
});

test('rejects missing or wrong token', () => {
  const env = { DTN_JOIN_TOKEN: 's3cret' };
  assert.equal(joinTokenOk(undefined, env), false);
  assert.equal(joinTokenOk('nope', env), false);
  assert.equal(joinTokenOk('s3cret', env), true);
});

test('joinTokenHeaders only when configured', () => {
  assert.deepEqual(joinTokenHeaders({}), {});
  assert.equal(joinTokenHeaders({ DTN_JOIN_TOKEN: 's3cret' })['x-yinghuo-join-token'], 's3cret');
});
