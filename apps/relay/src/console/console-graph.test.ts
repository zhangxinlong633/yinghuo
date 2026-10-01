import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConsoleHtml } from './console.page';

test('connections page leads with the coordinate map, not the two-row table', () => {
  const html = buildConsoleHtml({
    nodeId: 'Earth',
    port: 3101,
    peerUrl: 'http://127.0.0.1:3102',
  });
  const svgAt = html.indexOf('id="cn-svg"');
  const linksAt = html.indexOf('id="cn-links"');
  const detailAt = html.indexOf('class="card cn-detail"');
  assert.ok(svgAt > 0);
  assert.ok(detailAt > svgAt);
  assert.ok(linksAt > detailAt);
  assert.match(html, /\.edge\.direct/);
  assert.match(html, /\.edge\.heard/);
  assert.match(html, /\.node\.self/);
  assert.match(html, /'direct' : 'heard'/);
  assert.match(html, /id="st-nodes"/);
  assert.match(html, /id="st-seeds"/);
  assert.match(html, /id="st-age"/);
  assert.match(html, /<select id="dst">/);
  assert.match(html, /id="route-culled"/);
  assert.match(html, /id="route-candidates"/);
  assert.match(html, /id="route-next"/);
  assert.match(html, /\/api\/graph\/route\?dst=/);
});
