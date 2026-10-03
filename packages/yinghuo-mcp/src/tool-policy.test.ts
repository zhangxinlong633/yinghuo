import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertToolAllowed,
  isWriteTool,
  mcpMode,
} from './tool-policy.js';
import { formatAuditLine } from './audit.js';

test('write tools include send and plan_reload', () => {
  assert.equal(isWriteTool('yinghuo_send'), true);
  assert.equal(isWriteTool('yinghuo_plan_reload'), true);
  assert.equal(isWriteTool('yinghuo_status'), false);
  assert.equal(isWriteTool('yinghuo_inbox', { clear: true }), true);
  assert.equal(isWriteTool('yinghuo_inbox', { clear: false }), false);
});

test('read mode blocks writes', () => {
  assert.equal(mcpMode({ YINGHUO_MCP_MODE: 'read' }), 'read');
  assert.throws(() => assertToolAllowed('yinghuo_send', {}, { YINGHUO_MCP_MODE: 'read' }));
  assert.doesNotThrow(() => assertToolAllowed('yinghuo_status', {}, { YINGHUO_MCP_MODE: 'read' }));
});

test('bearer token comparison', () => {
  assert.equal(mcpMode({}), 'write');
});

test('audit line is one JSON object', () => {
  const line = formatAuditLine({
    t: 1,
    tool: 'yinghuo_status',
    ok: true,
    mode: 'read',
  });
  assert.equal(JSON.parse(line).tool, 'yinghuo_status');
});
