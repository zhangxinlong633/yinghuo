import assert from 'node:assert/strict';
import test from 'node:test';
import type { RelayRuntimeConfig } from '../config';
import { decodeBundle, loadBpCodec } from './bp-codec';
import { bundleFromDecoded, toWireBundle } from './wire';

function sampleCfg(): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Relay: 'ipn:2.1', Mars: 'ipn:3.1' },
    port: 3101,
    peerUrl: '',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    startedAt: 0,
  };
}

const sampleBundle = {
  id: 'x',
  src: 'Earth',
  dst: 'Mars',
  payload: 'p',
  createdAt: 1_600_000_000_000,
  ttlMs: 1000,
  hops: [],
  delivered: false,
};

test('toWireBundle uses plan EIDs', () => {
  loadBpCodec();
  const buf = toWireBundle(sampleBundle, sampleCfg());
  const d = decodeBundle(buf);
  assert.equal(d.dstEid, 'ipn:3.1');
  assert.equal(d.srcEid, 'ipn:1.1');
  assert.equal(d.payload.toString('utf8'), 'p');
});

test('bundleFromDecoded maps node names and rejects unknown EIDs', () => {
  loadBpCodec();
  const cfg = sampleCfg();
  const decoded = decodeBundle(toWireBundle(sampleBundle, cfg));
  const mapped = bundleFromDecoded(decoded, cfg, 'x');
  assert.equal(mapped.ok, true);
  if (mapped.ok) {
    assert.equal(mapped.bundle.src, 'Earth');
    assert.equal(mapped.bundle.dst, 'Mars');
    assert.equal(mapped.bundle.payload, 'p');
    assert.equal(mapped.bundle.id, 'x');
  }
  const unknown = bundleFromDecoded({ ...decoded, dstEid: 'ipn:9.9' }, cfg, 'x');
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.eid, 'ipn:9.9');
});
