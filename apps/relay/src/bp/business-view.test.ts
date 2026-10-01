import assert from 'node:assert/strict';
import test from 'node:test';
import type { RelayBundle } from '../bundle/bundle.types';
import { toBusinessSendFields } from './business-view';

const sampleBundle: RelayBundle = {
  id: 'Earth-B1',
  src: 'Earth',
  dst: 'Mars',
  payload: 'hello',
  createdAt: 1_600_000_000_000,
  ttlMs: 60_000,
  hops: [{ from: 'Earth', to: 'Relay', at: 1 }],
  delivered: false,
  state: 'WAITING',
  custodian: 'Earth',
  events: [{ t: 1, node: 'Earth', kind: 'CREATED', msg: 'send' }],
  wire: 'YWJj',
};

test('business send view omits network fields', () => {
  const view = toBusinessSendFields(sampleBundle);
  assert.deepEqual(Object.keys(view).sort(), ['dst', 'id', 'payload', 'src', 'ttlMs'].sort());
});
