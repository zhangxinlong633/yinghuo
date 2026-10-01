import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBpCodec, encodeBundle, decodeBundle, inspectBundle } from './bp-codec';

test('roundtrip payload through bplib codec', () => {
  loadBpCodec();
  const wire = encodeBundle({
    srcEid: 'ipn:1.1',
    dstEid: 'ipn:3.1',
    payload: 'tri-bp',
    createdAtMs: Date.now(),
    ttlMs: 120000,
  });
  assert.ok(wire.length > 0);
  const decoded = decodeBundle(wire);
  assert.equal(decoded.srcEid, 'ipn:1.1');
  assert.equal(decoded.dstEid, 'ipn:3.1');
  assert.equal(decoded.payload.toString('utf8'), 'tri-bp');
  const info = inspectBundle(wire);
  assert.equal(info.byteLength, wire.length);
  assert.equal(info.srcEid, 'ipn:1.1');
});
