import { Inject, Injectable } from '@nestjs/common';
import type { CyclicSchedule, DualContact } from '../bundle/bundle.types';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';
import { edgeKey, emptyGraph, mergeSummary } from './graph-merge';
import { decideNextHop, type RouteDecision } from './graph-route';
import type { GraphEdge, GraphNode, GraphSummary, LocalGraph } from './graph.types';

export const GRAPH_MAX_HOP = 3;
/** Join-created direct edges; gossip must not age them out. */
export const DIRECT_EDGE_DELAY_MS = 0;
/** Forward failures skip this neighbor until the window elapses. */
export const UNHEALTHY_MS = 30_000;
/** Always-open cyclic window so a new peer can gossip immediately. */
export const DEFAULT_JOIN_SCHEDULE: CyclicSchedule = {
  type: 'cyclic',
  periodMs: 30_000,
  openOffsetMs: 0,
  openDurationMs: 30_000,
};

export type JoinRemote = {
  nodeId: string;
  eid: string;
  port: number;
  x: number;
  y: number;
  peerUrl: string;
};

export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: Array<GraphEdge & { kind: 'direct' | 'heard' }>;
  peers: Array<{ id: string; url: string }>;
  stats: {
    nodeCount: number;
    peerCount: number;
    maxEdgeAgeMs: number;
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
  private readonly peers = new Map<string, string>();
  private readonly unhealthyUntil = new Map<string, number>();

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {
    this.rememberSelf();
  }

  snapshot(now = Date.now()): GraphSnapshot {
    const edges = [...this.graph.edges.values()].map((edge) => ({
      ...edge,
      kind: edge.direct ? ('direct' as const) : ('heard' as const),
    }));
    let maxEdgeAgeMs = 0;
    for (const edge of edges) {
      maxEdgeAgeMs = Math.max(maxEdgeAgeMs, Math.max(0, now - edge.originatedAt));
    }
    return {
      nodes: [...this.graph.nodes.values()],
      edges,
      peers: [...this.peers.entries()].map(([id, url]) => ({ id, url })),
      stats: {
        nodeCount: this.graph.nodes.size,
        peerCount: this.peers.size,
        maxEdgeAgeMs,
      },
    };
  }

  applyJoin(remote: JoinRemote): void {
    this.cfg.eidByNode[remote.nodeId] = remote.eid;
    this.upsertDirectPeer(
      remote.nodeId,
      remote.peerUrl,
      { id: remote.nodeId, eid: remote.eid, x: remote.x, y: remote.y },
      DEFAULT_JOIN_SCHEDULE,
    );
  }

  /**
   * Joiner side of POST /api/peer/join: record the bootstrap as a direct peer
   * (always-open cyclic contact) and merge the returned summary.
   */
  acceptBootstrap(bootstrapUrl: string, response: JoinResponse): void {
    const id = response.summary.from;
    const found = response.summary.nodes.find((n) => n.id === id);
    const node: GraphNode = {
      id,
      eid: found?.eid || response.localEid,
      x: found?.x ?? 0,
      y: found?.y ?? 0,
    };
    this.cfg.eidByNode[id] = node.eid;
    this.upsertDirectPeer(id, bootstrapUrl.replace(/\/$/, ''), node, DEFAULT_JOIN_SCHEDULE);
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
    this.graph = mergeSummary(this.graph, summary, { maxHop: GRAPH_MAX_HOP, now });
    for (const edge of directs) {
      this.graph.edges.set(edgeKey(edge.a, edge.b), edge);
    }
    this.rememberSelf();
  }

  exportSummary(): GraphSummary {
    return {
      from: this.cfg.nodeId,
      nodes: [...this.graph.nodes.values()],
      edges: [...this.graph.edges.values()],
    };
  }

  decide(dst: string, now: number): RouteDecision {
    const unhealthy = new Set<string>();
    for (const [id, until] of this.unhealthyUntil) {
      if (until > now) unhealthy.add(id);
      else this.unhealthyUntil.delete(id);
    }
    return decideNextHop({
      me: this.cfg.nodeId,
      dst,
      graph: this.graph,
      peerIds: [...this.peers.keys()],
      unhealthy,
      now,
    });
  }

  markUnhealthy(id: string, now = Date.now()): void {
    this.unhealthyUntil.set(id, now + UNHEALTHY_MS);
  }

  peerUrl(id: string): string | undefined {
    return this.peers.get(id);
  }

  listKnownNodeIds(): string[] {
    return [...this.graph.nodes.keys()];
  }

  upsertDirectPeer(id: string, url: string, node: GraphNode, edgeSchedule: CyclicSchedule, now = Date.now()): void {
    this.peers.set(id, url);
    this.graph.nodes.set(node.id, node);
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

  private rememberSelf(): void {
    this.graph.nodes.set(this.cfg.nodeId, {
      id: this.cfg.nodeId,
      eid: this.cfg.eid,
      x: this.cfg.x,
      y: this.cfg.y,
    });
  }
}
