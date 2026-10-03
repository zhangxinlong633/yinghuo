import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arcsToContactPlan, type EphemerisArc } from './ephemeris-adapter';

test('maps ephemeris arcs to absolute contacts', () => {
  const arcs: EphemerisArc[] = [
    { a: 'Earth', b: 'Relay', startMs: 100, endMs: 200, delayMs: 15_000 },
    { a: 'Relay', b: 'Mars', startMs: 300, endMs: 400, delayMs: 30_000 },
  ];
  const plan = arcsToContactPlan(arcs, {
    nodes: [
      { name: 'Earth', eid: 'ipn:1.1', role: 'ground' },
      { name: 'Relay', eid: 'ipn:2.1', role: 'orbiter' },
      { name: 'Mars', eid: 'ipn:3.1', role: 'lander' },
    ],
  });
  assert.equal(plan.contacts.length, 2);
  assert.equal(plan.contacts[0]!.schedule.type, 'absolute');
  assert.equal(plan.contacts[0]!.delayMs, 15_000);
  assert.deepEqual((plan.contacts[0]!.schedule as { windows: unknown[] }).windows, [
    { startMs: 100, endMs: 200 },
  ]);
});
