import * as fs from 'fs';
import * as path from 'path';
import type { DualContactPlan, DualNodeConfig } from './bundle/bundle.types';

/** Monorepo root: apps/relay/src|dist → ../../.. */
function monorepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function resolvePlanPath(): string {
  if (process.env.CONTACT_PLAN) {
    return path.resolve(process.env.CONTACT_PLAN);
  }
  const root = monorepoRoot();
  const candidates = [
    path.join(__dirname, '..', 'contact-plan.tri.json'),
    path.join(root, 'apps', 'relay', 'contact-plan.tri.json'),
    path.join(process.cwd(), 'apps', 'relay', 'contact-plan.tri.json'),
    path.join(process.cwd(), 'contact-plan.tri.json'),
    path.join(__dirname, '..', 'contact-plan.dual.json'),
    path.join(root, 'apps', 'relay', 'contact-plan.dual.json'),
    path.join(process.cwd(), 'apps', 'relay', 'contact-plan.dual.json'),
    path.join(process.cwd(), 'contact-plan.dual.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Pin LevelDB under monorepo data/<nodeId> unless DATA_DIR is absolute.
 * Relative DATA_DIR (e.g. ../../data/Earth) is cwd-dependent and caused empty
 * DBs / Overview all-zeros when npm cwd differed from apps/relay.
 */
function resolveDataDir(nodeId: string): string {
  const fallback = path.join(monorepoRoot(), 'data', nodeId);
  const raw = process.env.DATA_DIR;
  if (!raw) return fallback;
  if (path.isAbsolute(raw)) return raw;

  const fromCwd = path.resolve(process.cwd(), raw);
  // Prefer cwd resolution only when it already looks like a real store
  if (fs.existsSync(path.join(fromCwd, 'bundles')) || fs.existsSync(path.join(fromCwd, 'index'))) {
    return fromCwd;
  }
  // Relative ../../data/<node> from wrong cwd → still use monorepo data/
  return fallback;
}

const DEFAULT_EID_BY_NODE: Record<string, string> = {
  Earth: 'ipn:1.1',
  Relay: 'ipn:2.1',
  Mars: 'ipn:3.1',
};

function buildEidByNode(plan: DualContactPlan): Record<string, string> {
  const eidByNode: Record<string, string> = {};
  for (const n of plan.nodes) {
    const eid = n.eid ?? DEFAULT_EID_BY_NODE[n.name];
    if (eid) eidByNode[n.name] = eid;
  }
  return eidByNode;
}

export interface RelayRuntimeConfig {
  nodeId: string;
  eid: string;
  eidByNode: Record<string, string>;
  port: number;
  peerUrl: string;
  peers: Record<string, string>;
  role: DualNodeConfig['role'];
  nextHop: Record<string, string>;
  dataDir: string;
  plan: DualContactPlan;
  planPath: string;
  startedAt: number;
}

export function peerUrlFor(cfg: RelayRuntimeConfig, nextHopName: string): string {
  const fromMap = cfg.peers[nextHopName];
  if (fromMap) return fromMap;
  return cfg.peerUrl;
}

export function loadRelayConfig(): RelayRuntimeConfig {
  const planPath = resolvePlanPath();
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as DualContactPlan;
  const nodeId = process.env.NODE_ID ?? 'Earth';
  const node = plan.nodes.find((n) => n.name === nodeId);
  if (!node) {
    throw new Error(`NODE_ID=${nodeId} not found in contact plan ${planPath}`);
  }
  const port = Number(process.env.PORT ?? node.port);
  const peerUrl = process.env.PEER_URL ?? node.peerUrl;
  const eidByNode = buildEidByNode(plan);
  const eid = eidByNode[nodeId];
  if (!eid) {
    throw new Error(`No EID configured for NODE_ID=${nodeId} in contact plan ${planPath}`);
  }
  return {
    nodeId,
    eid,
    eidByNode,
    port,
    peerUrl,
    peers: node.peers ?? {},
    role: node.role,
    nextHop: node.nextHop,
    dataDir: resolveDataDir(nodeId),
    plan,
    planPath,
    startedAt: Date.now(),
  };
}
