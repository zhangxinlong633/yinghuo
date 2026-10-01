import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConsoleHtml } from './console.page.ts';

test('console html exposes plan trust + send gate + unhealthy host', () => {
  const html = buildConsoleHtml({
    nodeId: 'Earth',
    port: 3101,
    peerUrl: 'http://127.0.0.1:3102/',
  });
  for (const id of [
    'ov-plan-block', 'ov-plan-ver', 'ov-plan-ok', 'ov-plan-src',
    'ov-plan-path', 'ov-plan-watch', 'ov-plan-banner', 'btn-plan-reload',
    'send-gate-hint', 'cn-unhealthy',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const key of ['planReload', 'planKeepOld', 'sendDisabledDetail', 'planReloading']) {
    assert.match(html, new RegExp(key));
  }
});
