/**
 * Live dual-island graph. Skipped unless the cluster from
 * `apps/relay/scripts/dual-island.sh` is already up.
 *
 *   JOIN_KEEP=1 bash apps/relay/scripts/dual-island.sh
 *   DTN_LIVE_DUAL=1 npm test -w @yinghuo/relay -- src/live-dual-island.test.ts
 *
 * With bridge (also sets DTN_LIVE_DUAL_BRIDGE=1 expectations):
 *   JOIN_KEEP=1 BRIDGE=1 bash apps/relay/scripts/dual-island.sh
 *   DTN_LIVE_DUAL=1 DTN_LIVE_DUAL_BRIDGE=1 npm test -w @yinghuo/relay -- src/live-dual-island.test.ts
 *
 * BASE_PORT defaults to 3340 (a0..bridge on BASE_PORT+0..4).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const LIVE = process.env.DTN_LIVE_DUAL === '1';
const BRIDGE = process.env.DTN_LIVE_DUAL_BRIDGE === '1';
const BASE = Number(process.env.BASE_PORT ?? 3340);

const urls = {
  a0: `http://127.0.0.1:${BASE}`,
  a1: `http://127.0.0.1:${BASE + 1}`,
  b0: `http://127.0.0.1:${BASE + 2}`,
  b1: `http://127.0.0.1:${BASE + 3}`,
  bridge: `http://127.0.0.1:${BASE + 4}`,
};

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

test('live dual islands stay isolated before bridge', { skip: !LIVE }, async () => {
  for (const [name, url] of Object.entries(urls)) {
    if (!BRIDGE && name === 'bridge') {
      // bridge always starts in the script; still require health
    }
    const { res, body } = await json(`${url}/api/health`);
    assert.equal(res.status, 200, `${name} health`);
    assert.equal(body.ok, true);
  }

  const a0 = await json(`${urls.a0}/api/graph`);
  const b0 = await json(`${urls.b0}/api/graph`);
  const aIds = new Set((a0.body.nodes || []).map((n: { id: string }) => n.id));
  const bIds = new Set((b0.body.nodes || []).map((n: { id: string }) => n.id));

  assert.equal(a0.body.stats.componentCount, 1);
  assert.equal(b0.body.stats.componentCount, 1);
  assert.ok(aIds.has('a0') && aIds.has('a1'));
  assert.ok(bIds.has('b0') && bIds.has('b1'));
  assert.equal(aIds.has('b0'), false);
  assert.equal(aIds.has('b1'), false);
  assert.equal(bIds.has('a0'), false);
  assert.equal(bIds.has('a1'), false);
  assert.equal(bIds.has('bridge'), false);

  const a1 = await json(`${urls.a1}/api/graph`);
  assert.ok(a1.body.stats.peerCount >= 1, 'a1 should have joined a0');
});

test('live bridge merges islands into one component', { skip: !LIVE || !BRIDGE }, async () => {
  const br = await json(`${urls.bridge}/api/graph`);
  const ids = new Set((br.body.nodes || []).map((n: { id: string }) => n.id));
  assert.ok(ids.has('a0') && ids.has('b0') && ids.has('bridge'));
  assert.equal(br.body.stats.componentCount, 1);

  const a0 = await json(`${urls.a0}/api/graph`);
  const aIds = new Set((a0.body.nodes || []).map((n: { id: string }) => n.id));
  assert.ok(aIds.has('b0') || aIds.has('b1'), 'a0 should learn B-side via bridge gossip');
});
