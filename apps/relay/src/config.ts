import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DualContactPlan, PlanStatus } from './bundle/bundle.types';
import { normalizeContactPlan } from './contact/contact-plan-normalize';
import { validateContactPlan } from './contact/contact-plan-validate';
import { parseRole, type NodeRole } from './role/role-policy';

/** Monorepo root: apps/relay/src|dist → ../../.. */
function monorepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

export function resolvePlanPath(): string {
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
  return candidates[0]!;
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
  if (fs.existsSync(path.join(fromCwd, 'bundles')) || fs.existsSync(path.join(fromCwd, 'index'))) {
    return fromCwd;
  }
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

function buildRoleByNode(plan: DualContactPlan): Record<string, NodeRole> {
  const roleByNode: Record<string, NodeRole> = {};
  for (const n of plan.nodes) {
    roleByNode[n.name] = parseRole(n.role, 'endpoint');
  }
  return roleByNode;
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function planWatchEnabled(): boolean {
  const v = process.env.DTN_PLAN_WATCH;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

export function planContentVersion(rawText: string): string {
  return crypto.createHash('sha256').update(rawText).digest('hex').slice(0, 12);
}

export interface RelayRuntimeConfig {
  nodeId: string;
  eid: string;
  eidByNode: Record<string, string>;
  /** Roles known from the contact plan (and self). */
  roleByNode: Record<string, NodeRole>;
  port: number;
  peerUrl: string;
  peers: Record<string, string>;
  role: NodeRole;
  nextHop: Record<string, string>;
  dataDir: string;
  plan: DualContactPlan;
  planPath: string;
  planStatus: PlanStatus;
  startedAt: number;
  /** DTN_GRAPH_MODE=1 or plan.mode === 'graph'. */
  graphMode: boolean;
  x: number;
  y: number;
  bootstrapUrl?: string;
}

/** Graph-mode join peers win over the static plan map and the single peerUrl fallback. */
export function peerUrlFor(
  cfg: RelayRuntimeConfig,
  nextHopName: string,
  graph?: { peerUrl(id: string): string | undefined } | null,
): string {
  if (cfg.graphMode && graph) {
    const fromGraph = graph.peerUrl(nextHopName);
    if (fromGraph) return fromGraph;
  }
  const fromMap = cfg.peers[nextHopName];
  if (fromMap) return fromMap;
  return cfg.peerUrl;
}

let sharedConfig: RelayRuntimeConfig | null = null;

/** Shared boot config so main.ts and Nest use the same startedAt / plan. */
export function getOrLoadRelayConfig(): RelayRuntimeConfig {
  if (!sharedConfig) sharedConfig = loadRelayConfig();
  return sharedConfig;
}

export function resetSharedRelayConfigForTests(): void {
  sharedConfig = null;
}

export type ApplyPlanResult =
  | { ok: true; version: string; plan: DualContactPlan }
  | { ok: false; errors: string[] };

/**
 * Validate + normalize + mutate cfg.plan / routing maps.
 * Keeps cfg.startedAt, nodeId, port, dataDir, eid, role, graphMode.
 * Env PEER_URL still wins over plan peerUrl on reload.
 */
export function applyContactPlanToConfig(
  cfg: RelayRuntimeConfig,
  raw: unknown,
  rawText: string,
  source: PlanStatus['source'],
): ApplyPlanResult {
  const validated = validateContactPlan(raw, {
    nodeId: cfg.nodeId,
    graphMode: cfg.graphMode,
  });
  if (!validated.ok) return validated;

  const plan = normalizeContactPlan(validated.plan, cfg.startedAt);
  const afterNorm = validateContactPlan(plan, {
    nodeId: cfg.nodeId,
    graphMode: cfg.graphMode,
  });
  if (!afterNorm.ok) return afterNorm;

  const node = plan.nodes.find((n) => n.name === cfg.nodeId);
  const version = planContentVersion(rawText);
  const eidByNode = buildEidByNode(plan);
  eidByNode[cfg.nodeId] = cfg.eid;
  const roleByNode = buildRoleByNode(plan);
  roleByNode[cfg.nodeId] = cfg.role;

  cfg.plan = plan;
  cfg.eidByNode = eidByNode;
  cfg.roleByNode = roleByNode;
  cfg.nextHop = node?.nextHop ?? (cfg.graphMode ? {} : cfg.nextHop);
  cfg.peers = node?.peers ?? (cfg.graphMode ? cfg.peers : {});
  if (!process.env.PEER_URL && node?.peerUrl) {
    cfg.peerUrl = node.peerUrl;
  }

  cfg.planStatus = {
    path: cfg.planPath,
    version,
    loadedAt: Date.now(),
    source,
    ok: true,
    lastError: null,
    lastFailedAt: cfg.planStatus.lastFailedAt,
    watchEnabled: planWatchEnabled(),
  };
  return { ok: true, version, plan };
}

export function markPlanLoadError(cfg: RelayRuntimeConfig, errors: string[]): void {
  cfg.planStatus = {
    ...cfg.planStatus,
    ok: false,
    lastError: errors.join('; '),
    lastFailedAt: Date.now(),
    watchEnabled: planWatchEnabled(),
  };
}

export function loadRelayConfig(): RelayRuntimeConfig {
  const planPath = resolvePlanPath();
  const startedAt = Date.now();
  let rawText: string;
  try {
    rawText = fs.readFileSync(planPath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read contact plan ${planPath}: ${msg}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid JSON in contact plan ${planPath}: ${msg}`);
  }

  const nodeId = process.env.NODE_ID ?? 'Earth';
  const graphModeHint =
    envFlag('DTN_GRAPH_MODE') ||
    (typeof raw === 'object' && raw !== null && (raw as DualContactPlan).mode === 'graph');

  const validated = validateContactPlan(raw, { nodeId, graphMode: graphModeHint });
  if (!validated.ok) {
    throw new Error(`contact plan validation failed: ${validated.errors.join('; ')}`);
  }

  const plan = normalizeContactPlan(validated.plan, startedAt);
  const graphMode = envFlag('DTN_GRAPH_MODE') || plan.mode === 'graph';
  const node = plan.nodes.find((n) => n.name === nodeId);
  if (!node && !graphMode) {
    throw new Error(`NODE_ID=${nodeId} not found in contact plan ${planPath}`);
  }
  const port = Number(process.env.PORT ?? node?.port ?? 0);
  const peerUrl = process.env.PEER_URL ?? node?.peerUrl ?? '';
  const eidByNode = buildEidByNode(plan);
  const eid = process.env.EID ?? eidByNode[nodeId];
  if (!eid) {
    throw new Error(`No EID configured for NODE_ID=${nodeId} in contact plan ${planPath}`);
  }
  eidByNode[nodeId] = eid;
  const roleByNode = buildRoleByNode(plan);
  const bootstrapRaw = process.env.BOOTSTRAP_URL;
  const bootstrapUrl = bootstrapRaw && bootstrapRaw.length > 0 ? bootstrapRaw : undefined;
  const role = parseRole(process.env.ROLE ?? process.env.DTN_ROLE ?? node?.role, 'endpoint');
  roleByNode[nodeId] = role;
  const version = planContentVersion(rawText);
  return {
    nodeId,
    eid,
    eidByNode,
    roleByNode,
    port,
    peerUrl,
    peers: node?.peers ?? {},
    role,
    nextHop: node?.nextHop ?? {},
    dataDir: resolveDataDir(nodeId),
    plan,
    planPath,
    planStatus: {
      path: planPath,
      version,
      loadedAt: startedAt,
      source: 'boot',
      ok: true,
      lastError: null,
      lastFailedAt: null,
      watchEnabled: planWatchEnabled(),
    },
    startedAt,
    graphMode,
    x: numEnv('NODE_X', node?.x ?? 0),
    y: numEnv('NODE_Y', node?.y ?? 0),
    bootstrapUrl,
  };
}
