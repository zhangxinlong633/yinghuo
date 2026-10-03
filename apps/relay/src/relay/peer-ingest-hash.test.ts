import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import { loadBpCodec } from '../bp/bp-codec';
import { toWireBundle } from '../bp/wire';
import type { RelayBundle } from '../bundle/bundle.types';
import { payloadSha256 } from '../bundle/payload-hash';
import type { RelayRuntimeConfig } from '../config';
import { RelayController } from './relay.controller';

function cfg(): RelayRuntimeConfig {
  return {
    nodeId: 'Spare',
    eid: 'ipn:2.3',
    eidByNode: { Earth: 'ipn:1.1', Spare: 'ipn:2.3', Mars: 'ipn:3.1' },
    roleByNode: {},
    port: 3107,
    peerUrl: '',
    peers: {},
    role: 'orbiter',
    nextHop: {},
    graphMode: false,
    x: 0,
    y: 0,
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    planStatus: {
      path: '',
      version: 't',
      loadedAt: 0,
      source: 'boot',
      ok: true,
      lastError: null,
      lastFailedAt: null,
      watchEnabled: false,
    },
    startedAt: 0,
  };
}

test('peerIngest sets payloadSha256 from x-dtn-payload-sha256, not from the payload', async () => {
  loadBpCodec();
  const runtime = cfg();
  const wire = toWireBundle(
    {
      id: 'b-cbor',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      createdAt: 1_600_000_000_000,
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    runtime,
  );
  const declared = 'ab'.repeat(32);
  assert.notEqual(declared, payloadSha256('hi'));
  let seen: RelayBundle | undefined;
  const bundles = {
    ingestFromPeer(bundle: RelayBundle) {
      seen = bundle;
      return { accepted: true, delivered: false, event: 'REPLICA_STORE', msg: 'ok' };
    },
    recordOps() {},
  };
  const contacts = { isOpenTo: () => false };
  const controller = new RelayController(
    bundles as never,
    contacts as never,
    runtime,
  );
  const req = { body: wire } as Request;
  await controller.peerIngest(
    req,
    'application/cbor',
    'Earth',
    'b-cbor',
    undefined,
    undefined,
    '1',
    declared,
  );
  assert.ok(seen);
  assert.equal(seen.payload, 'hi');
  assert.equal(seen.payloadSha256, declared);
});
