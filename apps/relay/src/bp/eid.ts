import type { RelayRuntimeConfig } from '../config';

export function eidForNode(cfg: RelayRuntimeConfig, nodeName: string): string {
  const eid = cfg.eidByNode[nodeName];
  if (!eid) {
    throw new Error(`no EID configured for node ${nodeName}`);
  }
  return eid;
}

export function nodeForEid(cfg: RelayRuntimeConfig, eid: string): string | undefined {
  for (const [node, nodeEid] of Object.entries(cfg.eidByNode)) {
    if (nodeEid === eid) return node;
  }
  return undefined;
}
