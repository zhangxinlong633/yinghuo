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

export interface CyclicSchedule {
  type: 'cyclic';
  periodMs: number;
  openOffsetMs: number;
  openDurationMs: number;
}

export interface DualContact {
  a: string;
  b: string;
  delayMs: number;
  bandwidthBps?: number;
  schedule: CyclicSchedule;
}

export interface DualNodeConfig {
  name: string;
  role: 'endpoint' | 'relay' | 'hybrid';
  port: number;
  peerUrl: string;
  peers?: Record<string, string>;
  nextHop: Record<string, string>;
  eid?: string;
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

export interface RelayStatus {
  nodeId: string;
  role: string;
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
    schedule: CyclicSchedule;
    nextChangeAt: number;
    phase: string;
  };
  recentEvents: Array<{ t: number; event: string; msg: string }>;
}
