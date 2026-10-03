import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CyclicSchedule } from '../bundle/bundle.types';
import { edgeKey, emptyGraph, mergeSummary } from './graph-merge';

const sched: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30000,
  openOffsetMs: 0,
  openDurationMs: 10000,
};

test('keeps newer originatedAt and drops hopCount above max', () => {
  const local = emptyGraph();
  const once = mergeSummary(
    local,
    {
      from: 'B',
      nodes: [{ id: 'C', eid: 'ipn:3.1', x: 3, y: 0 }],
      edges: [
        { a: 'B', b: 'C', delayMs: 100, schedule: sched, originatedAt: 10, hopCount: 0 },
      ],
    },
    { maxHop: 3, now: 100 },
  );
  assert.equal(once.edges.get(edgeKey('B', 'C'))?.hopCount, 1);
  const tooFar = mergeSummary(
    once,
    {
      from: 'X',
      nodes: [],
      edges: [{ a: 'Y', b: 'Z', delayMs: 1, schedule: sched, originatedAt: 20, hopCount: 3 }],
    },
    { maxHop: 3, now: 100 },
  );
  assert.equal(tooFar.edges.has(edgeKey('Y', 'Z')), false);
});

test('drops nodes and edges outside localRegion when set', () => {
  const local = emptyGraph();
  local.nodes.set('Earth', { id: 'Earth', eid: 'ipn:1.1', x: 0, y: 0, region: 'earth' });
  const merged = mergeSummary(
    local,
    {
      from: 'Relay',
      nodes: [
        { id: 'Near', eid: 'ipn:2.1', x: 1, y: 0, region: 'earth' },
        { id: 'Phobos', eid: 'ipn:9.1', x: 9, y: 0, region: 'mars' },
      ],
      edges: [
        { a: 'Relay', b: 'Near', delayMs: 1, schedule: sched, originatedAt: 1, hopCount: 0 },
        { a: 'Relay', b: 'Phobos', delayMs: 1, schedule: sched, originatedAt: 1, hopCount: 0 },
      ],
    },
    { maxHop: 3, now: 100, localRegion: 'earth' },
  );
  assert.equal(merged.nodes.has('Near'), true);
  assert.equal(merged.nodes.has('Phobos'), false);
  assert.equal(merged.edges.has(edgeKey('Relay', 'Near')), true);
  assert.equal(merged.edges.has(edgeKey('Relay', 'Phobos')), false);
});

test('keeps foreign nodes when localRegion unset', () => {
  const merged = mergeSummary(
    emptyGraph(),
    {
      from: 'A',
      nodes: [{ id: 'Phobos', eid: 'ipn:9.1', x: 9, y: 0, region: 'mars' }],
      edges: [],
    },
    { maxHop: 3, now: 100 },
  );
  assert.equal(merged.nodes.has('Phobos'), true);
});
