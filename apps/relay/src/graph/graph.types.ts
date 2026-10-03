import type { ContactSchedule } from '../bundle/bundle.types';
import type { NodeRole } from '../role/role-policy';
import type { NodeTier } from './region-policy';

export type GraphNode = {
  id: string;
  eid: string;
  x: number;
  y: number;
  role?: NodeRole;
  componentId?: number;
  region?: string;
  tier?: NodeTier;
};
export type GraphEdge = {
  a: string;
  b: string;
  delayMs: number;
  schedule: ContactSchedule;
  originatedAt: number;
  hopCount: number;
  direct?: boolean;
};
export type RegionGateway = { region: string; nodeId: string; eid: string };

export type GraphSummary = {
  from: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  gateways?: RegionGateway[];
};
export type LocalGraph = { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> };
