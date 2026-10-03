import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  joinAllowed,
  localRegion,
  localTier,
  parseRegionPeers,
  parseTier,
  regionEnabled,
} from './region-policy';

test('empty DTN_REGION disables partitioning', () => {
  assert.equal(regionEnabled({}), false);
  assert.equal(regionEnabled({ DTN_REGION: '' }), false);
  assert.equal(localRegion({ DTN_REGION: 'earth' }), 'earth');
});

test('parseTier env then role: orbiter/cruise backbone else edge', () => {
  assert.equal(parseTier('backbone'), 'backbone');
  assert.equal(parseTier('edge'), 'edge');
  assert.equal(parseTier(undefined, 'orbiter'), 'backbone');
  assert.equal(parseTier(undefined, 'cruise'), 'backbone');
  assert.equal(parseTier(undefined, 'lander'), 'edge');
  assert.equal(parseTier(undefined, 'ground'), 'edge');
  assert.equal(localTier({ DTN_TIER: 'edge' }, 'orbiter'), 'edge');
});

test('parseRegionPeers splits region=url', () => {
  const m = parseRegionPeers('mars=http://127.0.0.1:3202, moon=http://127.0.0.1:3203');
  assert.equal(m.mars, 'http://127.0.0.1:3202');
  assert.equal(m.moon, 'http://127.0.0.1:3203');
});

test('joinAllowed: off or same region ok; foreign edge mismatch; backbone gateway ok', () => {
  assert.equal(joinAllowed({
    partitioning: false, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: undefined,
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'earth',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  const no = joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: ['mars'],
  });
  assert.equal(no.ok, false);
  if (!no.ok) assert.equal(no.error, 'REGION_MISMATCH');
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'backbone', regionPeerKeys: ['mars'],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'backbone', regionPeerKeys: [],
  }).ok, false);
});
