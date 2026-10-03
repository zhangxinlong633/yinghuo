import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolateEnv } from './env-interpolate';

test('replaces ${NAME} from env', () => {
  const out = interpolateEnv('http://${RELAY_HOST}:3103', { RELAY_HOST: '10.0.0.2' });
  assert.equal(out, 'http://10.0.0.2:3103');
});

test('leaves unknown placeholders', () => {
  assert.equal(interpolateEnv('x=${MISSING}y', {}), 'x=${MISSING}y');
});
