import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptIngest, applyAck, createBundle, markExpired, noteForwardFailed, shouldRetry } from './bundle-machine';

test('closed contact stores as WAITING and records STORED event', () => {
  const bundle = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: false,
  });
  assert.equal(bundle.state, 'WAITING');
  assert.equal(bundle.events[0].kind, 'STORED');
  assert.equal(bundle.events[0].node, 'Earth');
});

test('duplicate ingest keeps one copy', () => {
  const first = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const again = acceptIngest(first, first, 10, 'Relay', false);
  assert.equal(again.events.length, first.events.length);
  assert.equal(again.state, first.state);
});

test('forward failure returns to WAITING', () => {
  const live = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const failed = noteForwardFailed(live, 1000, 'Earth', 'peer down');
  assert.equal(failed.state, 'WAITING');
  assert.equal(failed.events.at(-1)?.kind, 'RETRY');
});

test('ttl expiry is terminal', () => {
  const live = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 1000, contactOpen: false,
  });
  const dead = markExpired(live, 1000, 'Relay');
  assert.equal(dead.state, 'EXPIRED');
});

test('ack merges downstream arrival', () => {
  const held = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const acked = applyAck(held, 50, 'Earth', 'Relay', [
    { t: 40, node: 'Mars', kind: 'ARRIVED', msg: 'inbox' },
  ]);
  assert.equal(acked.state, 'ACKED');
  assert.equal(acked.events.some((e) => e.kind === 'ARRIVED' && e.node === 'Mars'), true);
});

test('retry waits 1000ms', () => {
  assert.equal(shouldRetry(null, 0), true);
  assert.equal(shouldRetry(0, 999), false);
  assert.equal(shouldRetry(0, 1000), true);
});
