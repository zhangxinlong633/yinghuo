import type { NodeRole } from '../role/role-policy';
import type { BpInspect } from '../bp/bp-codec';

/** Educational Bundle (simplified BP primary block) for relay daemons. */
export interface RelayBundle {
  id: string;
  src: string;
  dst: string;
  payload: string;
  createdAt: number;
  ttlMs: number;
  hops: Array<{ from: string; to: string; at: number }>;
  delivered: boolean;
  state?: 'WAITING' | 'FORWARDING' | 'ARRIVED' | 'ACKED' | 'EXPIRED';
  custodian?: string;
  events?: Array<{ t: number; node: string; kind: string; msg: string }>;
  /** Base64 BPv7 CBOR captured at forward or ingest. Task 6 may refine this. */
  wire?: string;
}

export interface CustodyRecord {
  bundleId: string;
  waitingAck: boolean;
  from: string | null;
  heldAt: number;
}

export interface DeliveredMessage {
  id: string;
  src: string;
  dst: string;
  payload: string;
  deliveredAt: number;
  hops: Array<{ from: string; to: string; at: number }>;
}

/** Fields returned by POST /api/send on success (no custody/state/wire). */
export type BusinessSendFields = Pick<
  RelayBundle,
  'id' | 'src' | 'dst' | 'payload' | 'ttlMs'
>;

/** Inbox / recv message shape for application consumers. */
export type BusinessInboxMessage = Pick<
  DeliveredMessage,
  'id' | 'src' | 'dst' | 'payload' | 'deliveredAt'
>;

/** GET /api/bundles/:id — full ops record plus wire inspect when captured. */
export type RelayBundleOpsDetail = RelayBundle & {
  wireLength?: number;
  primary?: BpInspect;
};

export interface CyclicSchedule {
  type: 'cyclic';
  periodMs: number;
  openOffsetMs: number;
  openDurationMs: number;
}

export interface AbsoluteContactWindow {
  startMs: number;
  endMs: number;
}

/** Absolute epoch windows, or offset windows resolved at plan load. */
export interface AbsoluteSchedule {
  type: 'absolute';
  windows: AbsoluteContactWindow[];
}

export type ContactSchedule = CyclicSchedule | AbsoluteSchedule;

export interface DualContact {
  a: string;
  b: string;
  delayMs: number;
  bandwidthBps?: number;
  schedule: ContactSchedule;
}

export interface DualNodeConfig {
  name: string;
  role: NodeRole;
  port: number;
  peerUrl: string;
  peers?: Record<string, string>;
  /** Omitted in graph mode; static tri/dual plans still set a full table. */
  nextHop?: Record<string, string>;
  eid?: string;
  x?: number;
  y?: number;
}

export interface DualContactPlan {
  description?: string;
  mode?: string;
  scale?: string;
  nodes: DualNodeConfig[];
  contacts: DualContact[];
  application?: {
    src: string;
    dst: string;
    payload: string;
    ttlMs?: number;
  };
}

export interface PlanStatus {
  path: string;
  version: string;
  loadedAt: number;
  source: 'boot' | 'watch' | 'http';
  ok: boolean;
  lastError: string | null;
  lastFailedAt: number | null;
  watchEnabled: boolean;
}

export interface RelayStatus {
  nodeId: string;
  role: NodeRole;
  /** Canonical mission role after alias resolve. */
  missionRole: string;
  capabilities: {
    canInject: boolean;
    canRelay: boolean;
  };
  custodySemantics: string;
  routeBias: string;
  plan: PlanStatus;
  port: number;
  peerUrl: string;
  uptimeMs: number;
  store: {
    bundles: number;
    custody: number;
    index: number;
    inbox: number;
  };
  dataDir: string;
  contact: {
    peer: string;
    open: boolean;
    delayMs: number;
    schedule: ContactSchedule;
    nextChangeAt: number;
    phase: string;
  };
      recentEvents: Array<{ t: number; event: string; msg: string }>;
  clock: {
    wallMs: number;
    missionMs: number;
    epochMs: number | null;
    offsetMs: number;
  };
}
