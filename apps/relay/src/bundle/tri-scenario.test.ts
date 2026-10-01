import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCyclicOpen } from '../contact/contact-window';
import { acceptIngest, applyAck, createBundle, noteForwardFailed } from './bundle-machine';

const earthRelay = { periodMs: 30000, openOffsetMs: 0, openDurationMs: 10000 };
const relayMars = { periodMs: 30000, openOffsetMs: 15000, openDurationMs: 10000 };

test('bundle waits on Relay until the second contact, then Earth sees ARRIVED', () => {
  assert.equal(isCyclicOpen(1000, earthRelay), true);
  assert.equal(isCyclicOpen(1000, relayMars), false);

  const created = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 1000, ttlMs: 120000, contactOpen: true,
  });
  const atRelay = acceptIngest(undefined, created, 1200, 'Relay', false);
  assert.equal(atRelay.state, 'WAITING');
  assert.equal(atRelay.custodian, 'Relay');

  const earthAfterFirstAck = applyAck(created, 1300, 'Earth', 'Relay', atRelay.events);
  assert.equal(earthAfterFirstAck.state, 'ACKED');
  assert.equal(earthAfterFirstAck.events.some((e) => e.node === 'Mars' && e.kind === 'ARRIVED'), false);

  assert.equal(isCyclicOpen(16000, relayMars), true);
  const atMars = acceptIngest(undefined, atRelay, 16000, 'Mars', true);
  assert.equal(atMars.state, 'ARRIVED');

  const relayAcked = applyAck(atRelay, 16100, 'Relay', 'Mars', atMars.events);
  const earthDone = applyAck(earthAfterFirstAck, 16200, 'Earth', 'Relay', relayAcked.events);
  assert.equal(earthDone.events.some((e) => e.node === 'Mars' && e.kind === 'ARRIVED'), true);
});

test('down peer does not move the bundle', () => {
  const created = createBundle({
    id: 'Earth-2', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 1000, ttlMs: 120000, contactOpen: true,
  });
  const stuck = noteForwardFailed(created, 2000, 'Earth', 'ECONNREFUSED');
  assert.equal(stuck.custodian, 'Earth');
  assert.equal(stuck.state, 'WAITING');
});
