import type { CyclicSchedule } from '../bundle/bundle.types';

export type GraphNode = { id: string; eid: string; x: number; y: number };
export type GraphEdge = {
  a: string;
  b: string;
  delayMs: number;
  schedule: CyclicSchedule;
  originatedAt: number;
  hopCount: number;
  direct?: boolean;
};
export type GraphSummary = { from: string; nodes: GraphNode[]; edges: GraphEdge[] };
export type LocalGraph = { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> };
