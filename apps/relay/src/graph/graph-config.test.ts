import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRelayConfig } from '../config';

const TOUCHED = [
  'NODE_ID',
  'DTN_GRAPH_MODE',
  'NODE_X',
  'NODE_Y',
  'EID',
  'BOOTSTRAP_URL',
  'PORT',
  'PEER_URL',
  'CONTACT_PLAN',
] as const;

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of TOUCHED) saved.set(key, process.env[key]);
  for (const key of TOUCHED) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of TOUCHED) {
      const prev = saved.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

test('static plan stays off graph mode without DTN_GRAPH_MODE', () => {
  withEnv({ NODE_ID: 'Earth' }, () => {
    const cfg = loadRelayConfig();
    assert.equal(cfg.graphMode, false);
    assert.equal(cfg.x, 0);
    assert.equal(cfg.y, 0);
    assert.equal(cfg.bootstrapUrl, undefined);
    assert.equal(cfg.eid, 'ipn:1.1');
    assert.equal(cfg.nextHop.Mars, 'Relay');
  });
});

test('DTN_GRAPH_MODE, coordinates, EID, and BOOTSTRAP_URL override the plan', () => {
  withEnv(
    {
      NODE_ID: 'Earth',
      DTN_GRAPH_MODE: '1',
      NODE_X: '12',
      NODE_Y: '-3.5',
      EID: 'ipn:9.9',
      BOOTSTRAP_URL: 'http://127.0.0.1:3190',
    },
    () => {
      const cfg = loadRelayConfig();
      assert.equal(cfg.graphMode, true);
      assert.equal(cfg.x, 12);
      assert.equal(cfg.y, -3.5);
      assert.equal(cfg.eid, 'ipn:9.9');
      assert.equal(cfg.eidByNode.Earth, 'ipn:9.9');
      assert.equal(cfg.bootstrapUrl, 'http://127.0.0.1:3190');
    },
  );
});

test('graph mode can start a node that is not in the contact plan', () => {
  withEnv(
    {
      NODE_ID: 'Probe',
      DTN_GRAPH_MODE: '1',
      EID: 'ipn:10.1',
      PORT: '3210',
      NODE_X: '7',
      NODE_Y: '8',
      PEER_URL: 'http://127.0.0.1:3210',
    },
    () => {
      const cfg = loadRelayConfig();
      assert.equal(cfg.nodeId, 'Probe');
      assert.equal(cfg.eid, 'ipn:10.1');
      assert.equal(cfg.port, 3210);
      assert.equal(cfg.x, 7);
      assert.equal(cfg.y, 8);
      assert.equal(cfg.peerUrl, 'http://127.0.0.1:3210');
      assert.deepEqual(cfg.nextHop, {});
      assert.equal(cfg.role, 'endpoint');
    },
  );
});

test('ROLE env overrides plan role in graph mode', () => {
  withEnv(
    {
      NODE_ID: 'Probe',
      DTN_GRAPH_MODE: '1',
      EID: 'ipn:10.1',
      PORT: '3210',
      ROLE: 'relay',
    },
    () => {
      assert.equal(loadRelayConfig().role, 'relay');
    },
  );
});
