export type BundleState = 'WAITING' | 'FORWARDING' | 'ARRIVED' | 'ACKED' | 'EXPIRED';

export interface BundleEvent {
  t: number;
  node: string;
  kind: 'STORED' | 'WAITING' | 'FORWARD' | 'RETRY' | 'ARRIVED' | 'ACKED' | 'EXPIRED';
  msg: string;
}

export interface TrackedBundle {
  id: string;
  src: string;
  dst: string;
  payload: string;
  createdAt: number;
  ttlMs: number;
  state: BundleState;
  custodian: string;
  hops: Array<{ from: string; to: string; at: number }>;
  events: BundleEvent[];
}

function withEvent(bundle: TrackedBundle, event: BundleEvent): TrackedBundle {
  return { ...bundle, events: [...bundle.events, event] };
}

export function createBundle(input: {
  id: string; src: string; dst: string; payload: string; createdAt: number; ttlMs: number; contactOpen: boolean;
}): TrackedBundle {
  const state: BundleState = input.contactOpen ? 'FORWARDING' : 'WAITING';
  return {
    id: input.id,
    src: input.src,
    dst: input.dst,
    payload: input.payload,
    createdAt: input.createdAt,
    ttlMs: input.ttlMs,
    state,
    custodian: input.src,
    hops: [],
    events: [
      { t: input.createdAt, node: input.src, kind: 'STORED', msg: 'persisted' },
      { t: input.createdAt, node: input.src, kind: state === 'WAITING' ? 'WAITING' : 'FORWARD', msg: state },
    ],
  };
}

export function markExpired(bundle: TrackedBundle, now: number, node: string): TrackedBundle {
  if (bundle.state === 'EXPIRED' || bundle.state === 'ACKED') return bundle;
  return withEvent({ ...bundle, state: 'EXPIRED' }, { t: now, node, kind: 'EXPIRED', msg: 'ttl' });
}

export function noteForwardFailed(bundle: TrackedBundle, now: number, node: string, reason: string): TrackedBundle {
  return withEvent({ ...bundle, state: 'WAITING' }, { t: now, node, kind: 'RETRY', msg: reason });
}

export function acceptIngest(
  existing: TrackedBundle | undefined,
  incoming: TrackedBundle,
  now: number,
  node: string,
  atDestination: boolean
): TrackedBundle {
  if (existing) return existing;
  if (atDestination) {
    return withEvent(
      { ...incoming, state: 'ARRIVED', custodian: node },
      { t: now, node, kind: 'ARRIVED', msg: 'inbox' }
    );
  }
  return withEvent(
    { ...incoming, state: 'WAITING', custodian: node },
    { t: now, node, kind: 'STORED', msg: `accepted at ${node}` }
  );
}

export function applyAck(
  bundle: TrackedBundle,
  now: number,
  node: string,
  from: string,
  downstreamEvents: BundleEvent[]
): TrackedBundle {
  const seen = new Set(bundle.events.map((e) => `${e.t}|${e.node}|${e.kind}|${e.msg}`));
  const merged = [...bundle.events];
  for (const event of downstreamEvents) {
    const key = `${event.t}|${event.node}|${event.kind}|${event.msg}`;
    if (!seen.has(key)) merged.push(event);
  }
  merged.push({ t: now, node, kind: 'ACKED', msg: `acked by ${from}` });
  merged.sort((a, b) => a.t - b.t);
  return { ...bundle, state: 'ACKED', events: merged };
}

export function shouldRetry(lastRetryAt: number | null, now: number): boolean {
  if (lastRetryAt === null) return true;
  return now - lastRetryAt >= 1000;
}
