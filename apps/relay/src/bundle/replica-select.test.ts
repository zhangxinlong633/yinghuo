import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickReplicaTargets,
  replicaCount,
  replicaStrategy,
  type ReplicaCandidate,
} from './replica-select';

function cand(
  id: string,
  dist: number,
  extra: Partial<ReplicaCandidate> = {},
): ReplicaCandidate {
  return { id, dist, delayMs: 0, unhealthy: false, rolePenalty: 0, ...extra };
}

const field = [
  cand('Near', 1, { delayMs: 800, unhealthy: true }),
  cand('Mid', 4, { delayMs: 50 }),
  cand('Far', 20, { delayMs: 200 }),
  cand('Spare', 8, { delayMs: 40, rolePenalty: 5000 }),
];

test('picks up to two peers excluding self and listed hops', () => {
  assert.deepEqual(
    pickReplicaTargets({
      self: 'Earth',
      peers: ['Relay', 'Mars', 'Earth', 'Spare'],
      exclude: ['Relay'],
      n: 2,
    }),
    ['Mars', 'Spare'],
  );
});

test('default replica count is 2', () => {
  assert.equal(replicaCount({}), 2);
  assert.equal(replicaCount({ DTN_REPLICA_N: '0' }), 0);
  assert.equal(replicaCount({ DTN_REPLICA_N: '1' }), 1);
});

test('edge default replica n is 0 only when partitioning', () => {
  assert.equal(replicaCount({}, { partitioning: true, tier: 'edge' }), 0);
  assert.equal(replicaCount({ DTN_REPLICA_N: '2' }, { partitioning: true, tier: 'edge' }), 2);
  assert.equal(replicaCount({}, { partitioning: false, tier: 'edge' }), 2);
  assert.equal(replicaCount({}, { partitioning: true, tier: 'backbone' }), 2);
  assert.equal(replicaCount({}, { tier: 'edge' }), 2);
});

test('replica strategy env: nearest, quality, far', () => {
  assert.equal(replicaStrategy({}), 'quality');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: 'nearest' }), 'nearest');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: 'far' }), 'far');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: '最近' }), 'nearest');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: '质量' }), 'quality');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: '远' }), 'far');
  assert.equal(replicaStrategy({ DTN_REPLICA_STRATEGY: 'nope' }), 'quality');
});

test('nearest keeps closer peers and ranks unhealthy last', () => {
  assert.deepEqual(
    pickReplicaTargets({
      self: 'Earth',
      peers: field,
      exclude: ['Earth'],
      n: 2,
      strategy: 'nearest',
    }),
    ['Mid', 'Spare'],
  );
});

test('far keeps the most distant peers', () => {
  assert.deepEqual(
    pickReplicaTargets({
      self: 'Earth',
      peers: field,
      n: 2,
      strategy: 'far',
    }),
    ['Far', 'Spare'],
  );
});

test('quality prefers low delay+role cost and skips unhealthy first', () => {
  assert.deepEqual(
    pickReplicaTargets({
      self: 'Earth',
      peers: field,
      n: 2,
      strategy: 'quality',
    }),
    ['Mid', 'Far'],
  );
});
