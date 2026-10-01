import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatToolError, RelayHttpClient, RelayHttpError } from './relay-client.js';
import { resolveRelayUrl } from './relay-url.js';

test('resolveRelayUrl prefers DTN_RELAY_URL', () => {
  assert.equal(
    resolveRelayUrl({ DTN_RELAY_URL: 'http://127.0.0.1:3999/' }),
    'http://127.0.0.1:3999',
  );
});

test('resolveRelayUrl falls back to YINGHUO_RELAY_URL then DTN_NODE', () => {
  assert.equal(resolveRelayUrl({ YINGHUO_RELAY_URL: 'http://x:1' }), 'http://x:1');
  assert.equal(resolveRelayUrl({ DTN_NODE: 'Mars' }), 'http://127.0.0.1:3102');
  assert.equal(resolveRelayUrl({ DTN_NODE: 'Relay' }), 'http://127.0.0.1:3103');
  assert.equal(resolveRelayUrl({}), 'http://127.0.0.1:3101');
});

test('RelayHttpClient builds query URLs', () => {
  const c = new RelayHttpClient({ baseUrl: 'http://127.0.0.1:3101/' });
  assert.equal(
    c.buildUrl('/api/graph/route', { dst: 'Mars' }),
    'http://127.0.0.1:3101/api/graph/route?dst=Mars',
  );
});

test('RelayHttpClient maps non-2xx to RelayHttpError', async () => {
  const c = new RelayHttpClient({
    baseUrl: 'http://example.test',
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, errors: ['bad'] }), { status: 400 }),
  });
  await assert.rejects(() => c.getJson('/api/plan'), (err: unknown) => {
    assert.ok(err instanceof RelayHttpError);
    assert.equal(err.status, 400);
    assert.match(err.message, /bad/);
    return true;
  });
});

test('formatToolError is readable', () => {
  assert.match(
    formatToolError(new RelayHttpError(500, 'boom', 'http://x/api')),
    /HTTP 500/,
  );
  assert.equal(formatToolError(new Error('down')), 'down');
});
