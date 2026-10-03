import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payloadSha256 } from './payload-hash';
import { canPromoteReplica, replicaPromoteEnabled } from './replica-promote';

const hex = payloadSha256('hi');
const base = {
  replicaRole: 'replica' as const,
  replicaOf: 'Earth',
  payload: 'hi',
  payloadSha256: hex,
  unhealthyIds: ['Earth'],
  promoteEnabled: true,
};

test('promote env default on; 0/false/no off', () => {
  assert.equal(replicaPromoteEnabled({}), true);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: '0' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: 'false' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: 'NO' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: '1' }), true);
});

test('promotes replica when custodian unhealthy and hash ok', () => {
  assert.deepEqual(canPromoteReplica(base), { ok: true });
});

test('skips when promote disabled', () => {
  assert.deepEqual(canPromoteReplica({ ...base, promoteEnabled: false }), {
    ok: false,
    reason: 'promote-off',
  });
});

test('skips when not a replica', () => {
  assert.deepEqual(canPromoteReplica({ ...base, replicaRole: 'primary' }), {
    ok: false,
    reason: 'not-replica',
  });
});

test('skips when primary is not unhealthy (contact closed is not enough)', () => {
  assert.deepEqual(canPromoteReplica({ ...base, unhealthyIds: [] }), {
    ok: false,
    reason: 'primary-alive',
  });
});

test('skips legacy bundles without hash', () => {
  assert.deepEqual(
    canPromoteReplica({ ...base, payloadSha256: undefined }),
    { ok: false, reason: 'no-hash' },
  );
});

test('skips corrupt payload', () => {
  assert.deepEqual(canPromoteReplica({ ...base, payload: 'hj' }), {
    ok: false,
    reason: 'corrupt',
  });
});

test('skips missing replicaOf', () => {
  assert.deepEqual(canPromoteReplica({ ...base, replicaOf: undefined }), {
    ok: false,
    reason: 'missing-custodian',
  });
});
