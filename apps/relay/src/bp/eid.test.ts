import assert from 'node:assert/strict';
import test from 'node:test';
import { eidForNode, nodeForEid } from './eid';
import type { RelayRuntimeConfig } from '../config';

function cfg(partial: Partial<RelayRuntimeConfig> & Pick<RelayRuntimeConfig, 'eidByNode' | 'nodeId' | 'eid'>): RelayRuntimeConfig {
  return {
    port: 3101,
    peerUrl: '',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    startedAt: 0,
    ...partial,
  };
}

test('maps node names to plan EIDs', () => {
  const c = cfg({
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Relay: 'ipn:2.1', Mars: 'ipn:3.1' },
  });
  assert.equal(eidForNode(c, 'Mars'), 'ipn:3.1');
  assert.equal(nodeForEid(c, 'ipn:2.1'), 'Relay');
  assert.equal(nodeForEid(c, 'ipn:9.9'), undefined);
  assert.throws(() => eidForNode(c, 'Venus'), /no EID configured for node Venus/);
});
