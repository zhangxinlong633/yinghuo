/**
 * Live 10-node graph join. Skipped unless the cluster from
 * `apps/relay/scripts/join-cluster.sh` is already up.
 *
 *   JOIN_KEEP=1 bash apps/relay/scripts/join-cluster.sh
 *   DTN_LIVE_GRAPH=1 npm test -w @yinghuo/relay -- src/live-graph-join.test.ts
 *
 * BASE_PORT defaults to 3320 (node i on BASE_PORT+i).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const LIVE = process.env.DTN_LIVE_GRAPH === '1';
const BASE = Number(process.env.BASE_PORT ?? 3320);
const LAST = 9;

function nodeUrl(i: number): string {
  return `http://127.0.0.1:${BASE + i}`;
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 120_000,
  everyMs = 500,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v != null) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('live graph join node0 to node9', { skip: !LIVE }, async () => {
  for (const i of [0, 1, LAST]) {
    const { res, body } = await json(`${nodeUrl(i)}/api/health`);
    assert.equal(res.status, 200, `${nodeUrl(i)} health`);
    assert.equal(body.ok, true);
  }

  const graph0 = await json(`${nodeUrl(0)}/api/graph`);
  assert.ok(graph0.body.stats.nodeCount >= 10, `node0 nodeCount ${graph0.body.stats.nodeCount}`);
  assert.ok(graph0.body.stats.peerCount >= 9);

  const graph1 = await json(`${nodeUrl(1)}/api/graph`);
  assert.ok(graph1.body.stats.nodeCount >= 10, `node1 nodeCount ${graph1.body.stats?.nodeCount}`);
  const gossiped = (graph1.body.edges || []).some(
    (e: { hopCount?: number; kind?: string }) => (e.hopCount ?? 0) > 0 || e.kind === 'heard',
  );
  assert.equal(gossiped, true, 'node1 should have an edge learned by gossip');

  const route = await json(`${nodeUrl(0)}/api/graph/route?dst=node${LAST}`);
  assert.equal(route.body.nextHop, `node${LAST}`);

  const payload = `live-graph-${Date.now()}`;
  const sent = await json(`${nodeUrl(0)}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dst: `node${LAST}`, payload, ttlMs: 180000 }),
  });
  assert.equal(sent.res.status, 201);
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.src, 'node0');
  assert.equal(sent.body.dst, `node${LAST}`);
  assert.deepEqual(Object.keys(sent.body).sort(), ['dst', 'id', 'ok', 'payload', 'src', 'ttlMs']);

  const delivered = await waitFor('node9 inbox', async () => {
    const { body } = await json(`${nodeUrl(LAST)}/api/inbox`);
    const hit = (body.messages || []).find((m: { payload?: string }) => m.payload === payload);
    return hit ?? null;
  });
  assert.equal(delivered.src, 'node0');
  assert.equal(delivered.dst, `node${LAST}`);
  assert.equal(delivered.payload, payload);
  for (const k of Object.keys(delivered)) {
    assert.ok(!/eid/i.test(k), `inbox must not expose EID fields, got ${k}`);
  }
});
