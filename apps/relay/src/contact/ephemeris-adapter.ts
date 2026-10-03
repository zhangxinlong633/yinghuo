import type { DualContact, DualContactPlan, DualNodeConfig } from '../bundle/bundle.types';

export type EphemerisArc = {
  a: string;
  b: string;
  startMs: number;
  endMs: number;
  delayMs: number;
  bandwidthBps?: number;
};

export function arcsToContactPlan(
  arcs: EphemerisArc[],
  opts: {
    nodes: Array<Pick<DualNodeConfig, 'name' | 'role'> & Partial<DualNodeConfig>>;
    description?: string;
  },
): DualContactPlan {
  const contacts: DualContact[] = arcs.map((arc) => {
    const c: DualContact = {
      a: arc.a,
      b: arc.b,
      delayMs: arc.delayMs,
      schedule: { type: 'absolute', windows: [{ startMs: arc.startMs, endMs: arc.endMs }] },
    };
    if (arc.bandwidthBps !== undefined) c.bandwidthBps = arc.bandwidthBps;
    return c;
  });
  const nodes: DualNodeConfig[] = opts.nodes.map((n) => ({
    name: n.name,
    role: n.role,
    port: n.port ?? 0,
    peerUrl: n.peerUrl ?? '',
    ...(n.eid ? { eid: n.eid } : {}),
    ...(n.peers ? { peers: n.peers } : {}),
    ...(n.nextHop ? { nextHop: n.nextHop } : {}),
    ...(n.x !== undefined ? { x: n.x } : {}),
    ...(n.y !== undefined ? { y: n.y } : {}),
  }));
  return {
    description: opts.description ?? 'ephemeris-derived absolute contacts',
    mode: 'tri',
    nodes,
    contacts,
  };
}
