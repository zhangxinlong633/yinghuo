/**
 * Live three-node smoke. Requires Earth:3101 Relay:3103 Mars:3102 running
 * with the default tri contact plan. Run:
 *   DTN_LIVE_SMOKE=1 npm test -w @lightlink/relay -- src/live-tri-smoke.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const LIVE = process.env.DTN_LIVE_SMOKE === '1';
const EARTH = 'http://127.0.0.1:3101';
const RELAY = 'http://127.0.0.1:3103';
const MARS = 'http://127.0.0.1:3102';

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 45000,
  everyMs = 500
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v != null) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('live tri-node CBOR path', { skip: !LIVE }, async () => {
  for (const base of [EARTH, RELAY, MARS]) {
    const { res, body } = await json(`${base}/api/health`);
    assert.equal(res.status, 200, `${base} health`);
    assert.equal(body.ok, true);
  }

  const contacts = await json(`${EARTH}/api/contacts`);
  assert.equal(contacts.body.localEid, 'ipn:1.1');
  assert.equal(contacts.body.eidByNode.Mars, 'ipn:3.1');
  assert.equal(contacts.body.wireFormat, 'application/cbor');

  const payload = `live-smoke-${Date.now()}`;
  const sent = await json(`${EARTH}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dst: 'Mars', payload, ttlMs: 120000 }),
  });
  assert.equal(sent.res.status, 201);
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.payload, payload);
  assert.equal(sent.body.dst, 'Mars');
  assert.ok(sent.body.id);
  const keys = Object.keys(sent.body).sort();
  assert.deepEqual(keys, ['dst', 'id', 'ok', 'payload', 'src', 'ttlMs'].sort());
  assert.equal(sent.body.src, 'Earth');

  const detailEarly = await json(`${EARTH}/api/bundles/${encodeURIComponent(sent.body.id)}`);
  assert.equal(detailEarly.body.ok, true);
  assert.ok(detailEarly.body.bundle?.primary, 'wire encoded at send — primary present');
  assert.equal(detailEarly.body.bundle.primary.srcEid, 'ipn:1.1');
  assert.equal(detailEarly.body.bundle.primary.dstEid, 'ipn:3.1');
  assert.ok(detailEarly.body.bundle.primary.byteLength > 0);

  const from = 'Earth';
  const closedOrDecode = await fetch(`${RELAY}/api/peer/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/cbor',
      'x-dtn-from': from,
    },
    body: Buffer.from([0xff, 0x00, 0x01]),
  });
  assert.ok(
    closedOrDecode.status === 400 || closedOrDecode.status === 503,
    `bad CBOR → 400 or closed contact → 503, got ${closedOrDecode.status}`
  );
  if (closedOrDecode.status === 400) {
    const b = await closedOrDecode.json();
    assert.equal(b.event, 'DECODE_ERROR');
  } else {
    const b = await closedOrDecode.json();
    assert.equal(b.event || b.message?.event, 'CONTACT_CLOSED');
  }

  const relaySend = await json(`${RELAY}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dst: 'Mars', payload: 'nope' }),
  });
  assert.equal(relaySend.body.ok, false);
  assert.match(String(relaySend.body.error || ''), /role=relay/);

  const delivered = await waitFor('Mars inbox payload', async () => {
    const { body } = await json(`${MARS}/api/inbox`);
    const hit = (body.messages || []).find((m: { payload?: string }) => m.payload === payload);
    return hit ?? null;
  });
  assert.equal(delivered.src, 'Earth');
  assert.equal(delivered.dst, 'Mars');
  assert.equal(delivered.payload, payload);
  assert.ok(delivered.deliveredAt);
  for (const k of Object.keys(delivered)) {
    assert.ok(!/eid/i.test(k), `inbox must not expose EID fields, got ${k}`);
  }

  const earthDone = await waitFor('Earth ARRIVED event', async () => {
    const { body } = await json(`${EARTH}/api/bundles/${encodeURIComponent(sent.body.id)}`);
    const events = body.bundle?.events || [];
    return events.some((e: { kind?: string; node?: string }) => e.kind === 'ARRIVED' && e.node === 'Mars')
      ? body
      : null;
  });
  assert.ok(earthDone.bundle?.primary?.byteLength > 0);
});
