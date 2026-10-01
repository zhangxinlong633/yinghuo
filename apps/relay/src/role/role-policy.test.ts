import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROLE_PENALTY_MS,
  parseRole,
  resolveMissionRole,
  roleCapabilities,
  roleRoutePenalty,
} from './role-policy';

test('legacy aliases map to mission roles', () => {
  assert.equal(resolveMissionRole('endpoint'), 'lander');
  assert.equal(resolveMissionRole('relay'), 'orbiter');
  assert.equal(resolveMissionRole('hybrid'), 'cruise');
  assert.equal(resolveMissionRole('ground'), 'ground');
});

test('capabilities: orbiter cannot inject; lander/ground cannot relay', () => {
  assert.equal(roleCapabilities('orbiter').canInject, false);
  assert.equal(roleCapabilities('orbiter').canRelay, true);
  assert.equal(roleCapabilities('relay').canInject, false);
  assert.equal(roleCapabilities('ground').canInject, true);
  assert.equal(roleCapabilities('ground').canRelay, false);
  assert.equal(roleCapabilities('lander').canRelay, false);
  assert.equal(roleCapabilities('cruise').canInject, true);
  assert.equal(roleCapabilities('cruise').canRelay, true);
  assert.equal(roleCapabilities('hybrid').canRelay, true);
});

test('lander prefers orbiter over ground in route penalty', () => {
  assert.equal(roleRoutePenalty('lander', 'orbiter'), ROLE_PENALTY_MS.prefer);
  assert.equal(roleRoutePenalty('lander', 'ground'), ROLE_PENALTY_MS.avoid);
  assert.ok(roleRoutePenalty('lander', 'ground') > roleRoutePenalty('lander', 'orbiter'));
});

test('parseRole accepts mission and legacy', () => {
  assert.equal(parseRole('orbiter'), 'orbiter');
  assert.equal(parseRole('endpoint'), 'endpoint');
  assert.equal(parseRole('nope', 'relay'), 'relay');
});
