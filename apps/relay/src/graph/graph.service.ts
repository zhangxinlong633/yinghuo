import { Inject, Injectable } from '@nestjs/common';
import type { ContactSchedule, CyclicSchedule, DualContact } from '../bundle/bundle.types';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';
import { parseRole } from '../role/role-policy';
import { labelNodesWithComponents, weakComponents } from './graph-components';
import { edgeKey, emptyGraph, mergeSummary } from './graph-merge';
import { decideNextHop, type RouteDecision } from './graph-route';
import {
  joinAllowed,
  localRegion,
  localTier,
  parseRegionPeers,
  parseTier,
  regionEnabled,
} from './region-policy';
import type { GraphEdge, GraphNode, GraphSummary, LocalGraph, RegionGateway } from './graph.types';

export const GRAPH_MAX_HOP = 3;
/** Join-created direct edges; gossip must not age them out. */
export const DIRECT_EDGE_DELAY_MS = 0;
/** Default window to skip a neighbor after forward failure. Override: DTN_UNHEALTHY_MS. */
export const UNHEALTHY_MS = 30_000;
/** Heard-edge age above this is flagged stale in snapshots (display only). Override: DTN_HEARD_STALE_MS. */
export const HEARD_STALE_MS = 60_000;
/** Always-open cyclic window so a new peer can gossip immediately. */
export const DEFAULT_JOIN_SCHEDULE: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30_000,
  openOffsetMs: 0,
  openDurationMs: 30_000,
};

/** Gossip timer period and minimum spacing between graph pushes to the same peer. */
export const GOSSIP_INTERVAL_MS = 2_000;
export const GOSSIP_THROTTLE_MS = 2_000;

function msEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type JoinRemote = {
  nodeId: string;
  eid: string;
  port: number;
  x: number;
  y: number;
  peerUrl: string;
  role?: string;
  region?: string;
  tier?: string;
};

export type UnhealthyPeer = {
  id: string;
  untilMs: number;
  remainMs: number;
};

export type GraphSnapshot = {
  nodes: Array<GraphNode & { componentId: number }>;
  edges: Array<GraphEdge & { kind: 'direct' | 'heard'; ageMs: number; stale: boolean }>;
  peers: Array<{ id: string; url: string; unhealthy: boolean; unhealthyRemainMs: number }>;
  unhealthy: UnhealthyPeer[];
  stats: {
    nodeCount: number;
    peerCount: number;
    maxEdgeAgeMs: number;
    componentCount: number;
    unhealthyCount: number;
    heardStaleCount: number;
    unhealthyMs: number;
    heardStaleMs: number;
  };
};

export type JoinResponse = {
  ok: true;
  localEid: string;
  summary: GraphSummary;
};

@Injectable()
export class GraphService {
  private graph: LocalGraph = emptyGraph();
  private readonly gateways = new Map<string, RegionGateway>();
  /** Foreign peer id to dial when this node is the in-region door for that region. */
  private readonly foreignHops = new Map<string, string>();
  private readonly peers = new Map<string, string>();
  private readonly unhealthyUntil = new Map<string, number>();
  readonly unhealthyMs: number;
  readonly heardStaleMs: number;

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {
    this.unhealthyMs = msEnv('DTN_UNHEALTHY_MS', UNHEALTHY_MS);
    this.heardStaleMs = msEnv('DTN_HEARD_STALE_MS', HEARD_STALE_MS);
    this.rememberSelf();
  }

  snapshot(now = Date.now()): GraphSnapshot {
    this.pruneUnhealthy(now);
    const labels = weakComponents(this.graph);
    const unhealthy: UnhealthyPeer[] = [];
    for (const [id, until] of this.unhealthyUntil) {
      unhealthy.push({ id, untilMs: until, remainMs: Math.max(0, until - now) });
    }
    unhealthy.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const unhealthyIds = new Set(unhealthy.map((u) => u.id));

    let maxEdgeAgeMs = 0;
    let heardStaleCount = 0;
    const edges = [...this.graph.edges.values()].map((edge) => {
      const ageMs = Math.max(0, now - edge.originatedAt);
      maxEdgeAgeMs = Math.max(maxEdgeAgeMs, ageMs);
      const kind = edge.direct ? ('direct' as const) : ('heard' as const);
      const stale = kind === 'heard' && ageMs > this.heardStaleMs;
      if (stale) heardStaleCount += 1;
      return { ...edge, kind, ageMs, stale };
    });

    return {
      nodes: labelNodesWithComponents([...this.graph.nodes.values()], labels),
      edges,
      peers: [...this.peers.entries()].map(([id, url]) => ({
        id,
        url,
        unhealthy: unhealthyIds.has(id),
        unhealthyRemainMs: unhealthyIds.has(id)
          ? Math.max(0, (this.unhealthyUntil.get(id) ?? now) - now)
          : 0,
      })),
      unhealthy,
      stats: {
        nodeCount: this.graph.nodes.size,
        peerCount: this.peers.size,
        maxEdgeAgeMs,
        componentCount: labels.componentCount,
        unhealthyCount: unhealthy.length,
        heardStaleCount,
        unhealthyMs: this.unhealthyMs,
        heardStaleMs: this.heardStaleMs,
      },
    };
  }

  /** Active unhealthy peer ids at `now` (side-effect: prune expired). */
  listUnhealthy(now = Date.now()): string[] {
    this.pruneUnhealthy(now);
    return [...this.unhealthyUntil.keys()].sort();
  }

  evaluateJoin(remote: JoinRemote): ReturnType<typeof joinAllowed> {
    const partitioning = regionEnabled();
    const mine = localRegion() ?? '';
    const remoteTier = parseTier(remote.tier, remote.role);
    return joinAllowed({
      partitioning,
      localRegion: mine,
      remoteRegion: remote.region,
      localTier: localTier(process.env, this.cfg.role),
      remoteTier,
      regionPeerKeys: Object.keys(parseRegionPeers(process.env.DTN_REGION_PEERS)),
    });
  }

  listGateways(): RegionGateway[] {
    return [...this.gateways.values()];
  }

  applyJoin(remote: JoinRemote): void {
    const role = remote.role ? parseRole(remote.role) : undefined;
    if (role) this.cfg.roleByNode[remote.nodeId] = role;
    const region = remote.region ?? localRegion() ?? undefined;
    const tier = parseTier(remote.tier, remote.role);
    const mine = localRegion();
    this.upsertDirectPeer(
      remote.nodeId,
      remote.peerUrl,
      { id: remote.nodeId, eid: remote.eid, x: remote.x, y: remote.y, role, region, tier },
      DEFAULT_JOIN_SCHEDULE,
    );
    if (mine && remote.region && remote.region !== mine) {
      this.recordDoor(remote.region, remote.nodeId);
      this.graph.nodes.delete(remote.nodeId);
      delete this.cfg.eidByNode[remote.nodeId];
    }
  }

  /**
   * Joiner side of POST /api/peer/join: record the bootstrap as a direct peer
   * (always-open cyclic contact) and merge the returned summary.
   */
  acceptBootstrap(bootstrapUrl: string, response: JoinResponse): void {
    const id = response.summary.from;
    const found = response.summary.nodes.find((n) => n.id === id);
    const role = found?.role ?? this.cfg.roleByNode[id];
    const url = bootstrapUrl.replace(/\/$/, '');
    const mine = localRegion();
    const remoteRegion = found?.region;
    if (role) this.cfg.roleByNode[id] = role;
    const node: GraphNode = {
      id,
      eid: found?.eid || response.localEid,
      x: found?.x ?? 0,
      y: found?.y ?? 0,
      role,
      region: remoteRegion,
      tier: found?.tier,
    };
    this.upsertDirectPeer(id, url, node, DEFAULT_JOIN_SCHEDULE);
    if (mine && remoteRegion && remoteRegion !== mine) {
      this.recordDoor(remoteRegion, id);
      this.graph.nodes.delete(id);
      delete this.cfg.eidByNode[id];
    }
    this.ingestSummary(response.summary);
  }

  /** Direct edges incident to this node, as contact-plan rows for ContactService. */
  directContacts(): DualContact[] {
    const me = this.cfg.nodeId;
    const out: DualContact[] = [];
    for (const edge of this.graph.edges.values()) {
      if (!edge.direct) continue;
      if (edge.a !== me && edge.b !== me) continue;
      out.push({
        a: edge.a,
        b: edge.b,
        delayMs: edge.delayMs,
        schedule: edge.schedule,
      });
    }
    return out;
  }

  buildJoinResponse(): JoinResponse {
    return { ok: true, localEid: this.cfg.eid, summary: this.exportSummary() };
  }

  ingestSummary(summary: GraphSummary, now = Date.now()): void {
    const directs = [...this.graph.edges.values()].filter((edge) => edge.direct);
    this.graph = mergeSummary(this.graph, summary, {
      maxHop: GRAPH_MAX_HOP,
      now,
      localRegion: localRegion(),
    });
    for (const edge of directs) {
      this.graph.edges.set(edgeKey(edge.a, edge.b), edge);
    }
    if (localRegion()) {
      for (const [key, edge] of this.graph.edges) {
        if (!this.graph.nodes.has(edge.a) || !this.graph.nodes.has(edge.b)) {
          this.graph.edges.delete(key);
        }
      }
    }
    const mine = localRegion();
    for (const gateway of summary.gateways ?? []) {
      if (mine && gateway.region === mine) continue;
      if (this.foreignHops.has(gateway.region)) continue;
      this.gateways.set(gateway.region, gateway);
    }
    for (const node of this.graph.nodes.values()) {
      if (node.eid) this.cfg.eidByNode[node.id] = node.eid;
      if (node.role) this.cfg.roleByNode[node.id] = parseRole(node.role);
      else if (this.cfg.roleByNode[node.id] && !node.role) {
        node.role = this.cfg.roleByNode[node.id];
      }
    }
    this.rememberSelf();
  }

  exportSummary(): GraphSummary {
    const mine = localRegion();
    const partitioning = regionEnabled();
    const tier = localTier(process.env, this.cfg.role);
    let nodes = [...this.graph.nodes.values()];
    let edges = [...this.graph.edges.values()];
    if (partitioning && tier === 'edge') {
      const me = this.cfg.nodeId;
      const keep = new Set<string>([me, ...this.peers.keys()]);
      nodes = nodes.filter((node) => keep.has(node.id));
      edges = edges.filter((edge) => edge.direct === true && (edge.a === me || edge.b === me));
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => nodeIds.has(edge.a) && nodeIds.has(edge.b));
    const summary: GraphSummary = {
      from: this.cfg.nodeId,
      nodes: nodes.map((node) => ({
        ...node,
        region: node.region ?? mine ?? undefined,
        tier: node.tier ?? parseTier(undefined, node.role),
      })),
      edges,
    };
    if (partitioning && tier === 'backbone') {
      summary.gateways = [...this.gateways.values()];
    }
    return summary;
  }

  decide(dst: string, now: number, dstRegion?: string): RouteDecision {
    this.pruneUnhealthy(now);
    const unhealthy = new Set(this.unhealthyUntil.keys());
    return decideNextHop({
      me: this.cfg.nodeId,
      dst,
      graph: this.graph,
      peerIds: [...this.peers.keys()],
      unhealthy,
      now,
      meRole: this.cfg.role,
      partitioning: regionEnabled(),
      meTier: localTier(process.env, this.cfg.role),
      gateways: this.listGateways(),
      regionHops: [...this.foreignHops.entries()].map(([region, nodeId]) => ({ region, nodeId })),
      dstRegion,
    });
  }

  markUnhealthy(id: string, now = Date.now()): void {
    this.unhealthyUntil.set(id, now + this.unhealthyMs);
  }

  peerUrl(id: string): string | undefined {
    return this.peers.get(id);
  }

  listDirectPeerIds(): string[] {
    return [...this.peers.keys()].sort();
  }

  listKnownNodeIds(): string[] {
    return [...this.graph.nodes.keys()];
  }

  upsertDirectPeer(id: string, url: string, node: GraphNode, edgeSchedule: ContactSchedule, now = Date.now()): void {
    this.peers.set(id, url);
    const role = node.role ?? this.cfg.roleByNode[id];
    const withRole: GraphNode = role ? { ...node, role } : node;
    this.graph.nodes.set(withRole.id, withRole);
    if (withRole.eid) this.cfg.eidByNode[withRole.id] = withRole.eid;
    if (role) this.cfg.roleByNode[id] = role;
    const [a, b] = this.cfg.nodeId < id ? [this.cfg.nodeId, id] : [id, this.cfg.nodeId];
    const edge: GraphEdge = {
      a,
      b,
      delayMs: DIRECT_EDGE_DELAY_MS,
      schedule: edgeSchedule,
      originatedAt: now,
      hopCount: 0,
      direct: true,
    };
    this.graph.edges.set(edgeKey(a, b), edge);
    this.rememberSelf();
  }

  private recordDoor(region: string, foreignId: string): void {
    this.gateways.set(region, {
      region,
      nodeId: this.cfg.nodeId,
      eid: this.cfg.eid,
    });
    this.foreignHops.set(region, foreignId);
  }

  private pruneUnhealthy(now: number): void {
    for (const [id, until] of this.unhealthyUntil) {
      if (until <= now) this.unhealthyUntil.delete(id);
    }
  }

  private rememberSelf(): void {
    this.graph.nodes.set(this.cfg.nodeId, {
      id: this.cfg.nodeId,
      eid: this.cfg.eid,
      x: this.cfg.x,
      y: this.cfg.y,
      role: this.cfg.role,
    });
  }
}
