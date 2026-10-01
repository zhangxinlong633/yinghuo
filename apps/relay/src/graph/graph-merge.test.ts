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
