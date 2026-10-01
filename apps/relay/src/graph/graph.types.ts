import type { ContactSchedule } from '../bundle/bundle.types';
import type { NodeRole } from '../role/role-policy';

export type GraphNode = {
  id: string;
  eid: string;
  x: number;
  y: number;
  role?: NodeRole;
  componentId?: number;
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
export type GraphSummary = { from: string; nodes: GraphNode[]; edges: GraphEdge[] };
export type LocalGraph = { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> };