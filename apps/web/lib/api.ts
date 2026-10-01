const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface ContactWindow {
  a: string;
  b: string;
  windows: Array<[number, number]>;
  delayMs: number;
  bandwidthBps?: number;
}

export interface ContactPlan {
  description?: string;
  scale?: string;
  nodes: Array<{ name: string; nextHop: Record<string, string>; role?: 'endpoint' | 'relay' | 'hybrid' }>;
  contacts: ContactWindow[];
  application?: {
    src: string;
    dst: string;
    payload: string;
    ttlMs?: number;
    atMs?: number;
  };
  maxTimeMs?: number;
  tickMs?: number;
}

export interface SimEvent {
  t: number;
  event: string;
  node: string;
  msg: string;
}

export interface SimulateResult {
  success: boolean;
  pending: number;
  storeSizes: Record<string, number>;
  events: SimEvent[];
  plan: ContactPlan;
  maxTimeMs: number;
  runId?: string;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  success: boolean;
  pending: number;
  summary: string;
  eventCount: number;
  maxTimeMs: number;
}

export interface SavedRun {
  id: string;
  createdAt: string;
  success: boolean;
  pending: number;
  storeSizes: Record<string, number>;
  events: SimEvent[];
  plan: ContactPlan;
  maxTimeMs: number;
  roles: Record<string, string>;
  summary: string;
}

export async function fetchPlan(): Promise<ContactPlan> {
  const res = await fetch(`${API_BASE}/plan`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`plan HTTP ${res.status}`);
  return res.json();
}

export async function runSimulate(): Promise<SimulateResult> {
  const res = await fetch(`${API_BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`simulate HTTP ${res.status}`);
  return res.json();
}

export async function fetchRuns(limit = 50): Promise<RunSummary[]> {
  const res = await fetch(`${API_BASE}/runs?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`runs HTTP ${res.status}`);
  return res.json();
}

export async function fetchRun(id: string): Promise<SavedRun> {
  const res = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`run HTTP ${res.status}`);
  return res.json();
}
