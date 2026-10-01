/**
 * Minimal educational DTN core — Bundle Protocol-inspired (NOT full BP/ION).
 * Features: store-and-forward, scheduled contacts, custody-ish ACK, static next-hop,
 * node roles (endpoint | relay | hybrid).
 */

/** DTN node role: what traffic the node may inject / deliver / forward. */
export type NodeRole = 'endpoint' | 'relay' | 'hybrid';

export interface Bundle {
  id: string;
  src: string;
  dst: string;
  payload: string;
  createdAt: number;
  ttlMs: number;
  hops: Array<{ from: string; to: string; at: number }>;
  delivered: boolean;
}

export interface Contact {
  a: string;
  b: string;
  /** [openAt, closeAt] in sim ms */
  windows: Array<[number, number]>;
  /** one-way transmission + propagation delay */
  delayMs: number;
  /** optional bandwidth hint (bps) for k8s / CGR sketches */
  bandwidthBps?: number;
}

export interface StoreEntry {
  bundle: Bundle;
  waitingAck: boolean;
  from: string | null;
}

export interface ContactPlanJson {
  description?: string;
  scale?: string;
  nodes: Array<{
    name: string;
    nextHop: Record<string, string>;
    /** omitted → hybrid (backward compatible) */
    role?: NodeRole;
  }>;
  contacts: Array<{
    a: string;
    b: string;
    windows: Array<[number, number]>;
    delayMs: number;
    bandwidthBps?: number;
  }>;
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

let bundleSeq = 0;

/** Create a new bundle (simplified BP primary block). */
export function createBundle(
  src: string,
  dst: string,
  payload: string,
  ttlMs = 60000
): Bundle {
  return {
    id: `B${++bundleSeq}`,
    src,
    dst,
    payload,
    createdAt: 0,
    ttlMs,
    hops: [],
    delivered: false,
  };
}

/**
 * Contact schedule entry: link between two nodes that opens/closes on a timeline.
 */
export function createContact(
  a: string,
  b: string,
  windows: Array<[number, number]>,
  delayMs: number,
  bandwidthBps?: number
): Contact {
  return { a, b, windows, delayMs, bandwidthBps };
}

export function contactOpen(contact: Contact, t: number): boolean {
  return contact.windows.some(([o, c]) => t >= o && t < c);
}

export function involves(contact: Contact, x: string, y: string): boolean {
  return (contact.a === x && contact.b === y) || (contact.a === y && contact.b === x);
}

/**
 * DTN Node: store-and-forward with custody until next-hop ACK or TTL expiry.
 * Role gates application inject, delivery, and relay-for-others.
 */
export class Node {
  name: string;
  nextHop: Record<string, string>;
  role: NodeRole;
  store: Map<string, StoreEntry>;
  sim: Simulator | null = null;

  constructor(
    name: string,
    nextHopTable?: Record<string, string>,
    role: NodeRole = 'hybrid'
  ) {
    this.name = name;
    this.nextHop = nextHopTable || {};
    this.role = role;
    this.store = new Map();
  }

  /** Accept a new application payload or a forwarded bundle. */
  ingest(bundle: Bundle, from: string | null = null): void {
    if (!this.sim) return;
    const t = this.sim.now;
    if (bundle.delivered) return;

    // Destination match → deliver to application (demo: Relay should never be dest)
    if (bundle.dst === this.name) {
      if (this.role === 'relay') {
        this.sim.log(
          t,
          'DELIVER',
          this.name,
          `${bundle.id} unusual: relay is destination — treating as deliver "${bundle.payload}" from=${bundle.src}`
        );
      } else {
        this.sim.log(
          t,
          'DELIVER',
          this.name,
          `${bundle.id} payload="${bundle.payload}" from=${bundle.src}`
        );
      }
      bundle.delivered = true;
      if (from) this._sendAck(bundle, from);
      return;
    }

    // Application inject (from === null): only endpoint / hybrid
    if (from === null) {
      if (this.role === 'relay') {
        this.sim.log(
          t,
          'REJECT',
          this.name,
          `${bundle.id} role=relay cannot inject application traffic`
        );
        return;
      }
      // endpoint / hybrid: store origin traffic and try forward
    } else {
      // Forwarded from peer: endpoints refuse to store/relay for others
      if (this.role === 'endpoint') {
        this.sim.log(
          t,
          'REJECT',
          this.name,
          `${bundle.id} role=endpoint refuses to relay for others (dst=${bundle.dst})`
        );
        return;
      }
      // relay / hybrid: store-and-forward
    }

    if (!this.store.has(bundle.id)) {
      this.store.set(bundle.id, { bundle, waitingAck: false, from });
      this.sim.log(t, 'STORE', this.name, `${bundle.id} →${bundle.dst} (store size=${this.store.size})`);
    }
    if (from) this._sendAck(bundle, from);
    this._tryForward(bundle.id);
  }

  private _sendAck(bundle: Bundle, to: string): void {
    if (!this.sim) return;
    const delay = this.sim.linkDelay(this.name, to);
    this.sim.schedule(delay, () => {
      const peer = this.sim!.nodes.get(to);
      if (peer) peer._onAck(bundle.id, this.name);
    });
  }

  private _onAck(bundleId: string, from: string): void {
    if (!this.sim) return;
    const entry = this.store.get(bundleId);
    if (!entry) return;
    this.sim.log(this.sim.now, 'ACK', this.name, `${bundleId} acked by ${from} — release custody`);
    this.store.delete(bundleId);
  }

  /** Attempt to send stored bundles when contact is open. */
  tick(): void {
    if (!this.sim) return;
    for (const id of [...this.store.keys()]) {
      this._tryForward(id);
    }
    const t = this.sim.now;
    for (const [id, entry] of this.store) {
      if (t - entry.bundle.createdAt > entry.bundle.ttlMs) {
        this.sim.log(t, 'EXPIRE', this.name, `${id} TTL exceeded — drop`);
        this.store.delete(id);
      }
    }
  }

  private _tryForward(bundleId: string): void {
    if (!this.sim) return;
    const entry = this.store.get(bundleId);
    if (!entry || entry.waitingAck) return;
    const { bundle } = entry;
    const next = this.nextHop[bundle.dst];
    if (!next) {
      this.sim.log(this.sim.now, 'NOROUTE', this.name, `${bundleId} no next-hop for ${bundle.dst}`);
      return;
    }
    // Only forward when contact window is open (schedule-aware)
    if (!this.sim.contactOpen(this.name, next)) return;

    entry.waitingAck = true;
    bundle.hops.push({ from: this.name, to: next, at: this.sim.now });
    const delay = this.sim.linkDelay(this.name, next);
    this.sim.log(
      this.sim.now,
      'FORWARD',
      this.name,
      `${bundleId} → ${next} (delay=${delay}ms, contact open)`
    );
    this.sim.schedule(delay, () => {
      const peer = this.sim!.nodes.get(next);
      if (peer) peer.ingest(bundle, this.name);
      this.sim!.schedule(delay + 50, () => {
        const e = this.store.get(bundleId);
        if (e && e.waitingAck) {
          e.waitingAck = false;
          this.sim!.log(
            this.sim!.now,
            'RETRY',
            this.name,
            `${bundleId} no ACK yet — will retry when contact open`
          );
        }
      });
    });
  }
}

interface QueueItem {
  at: number;
  fn: () => void;
}

/**
 * Discrete-event simulator with virtual time.
 */
export class Simulator {
  now = 0;
  nodes = new Map<string, Node>();
  contacts: Contact[] = [];
  queue: QueueItem[] = [];
  running = false;
  events: SimEvent[] = [];
  quiet = false;

  addNode(node: Node): void {
    node.sim = this;
    this.nodes.set(node.name, node);
  }

  addContact(contact: Contact): void {
    this.contacts.push(contact);
  }

  contactOpen(a: string, b: string): boolean {
    return this.contacts.some((c) => involves(c, a, b) && contactOpen(c, this.now));
  }

  linkDelay(a: string, b: string): number {
    const c = this.contacts.find((x) => involves(x, a, b));
    return c ? c.delayMs : 1000;
  }

  schedule(delayMs: number, fn: () => void): void {
    this.queue.push({ at: this.now + delayMs, fn });
    this.queue.sort((x, y) => x.at - y.at);
  }

  log(t: number, event: string, node: string, msg: string): void {
    this.events.push({ t, event, node, msg });
    if (!this.quiet) {
      const pad = String(t).padStart(6);
      console.log(`[t=${pad}ms] ${event.padEnd(8)} @${node.padEnd(6)} ${msg}`);
    }
  }

  send(src: string, dst: string, payload: string, ttlMs = 60000): void {
    const node = this.nodes.get(src);
    if (node && node.role === 'relay') {
      this.log(
        this.now,
        'REJECT',
        src,
        `role=relay cannot CREATE / inject application traffic ${src}→${dst}`
      );
      return;
    }
    const b = createBundle(src, dst, payload, ttlMs);
    b.createdAt = this.now;
    this.log(this.now, 'CREATE', src, `${b.id} ${src}→${dst} "${payload}" ttl=${ttlMs}ms`);
    if (node) node.ingest(b);
  }

  async run(maxTime = 30000, tickMs = 100): Promise<void> {
    this.running = true;
    const scheduleTick = (t: number): void => {
      if (t > maxTime) return;
      this.schedule(t - this.now || tickMs, () => {
        for (const n of this.nodes.values()) n.tick();
        this._announceContacts();
        if (this.now + tickMs <= maxTime) scheduleTick(this.now + tickMs);
      });
    };
    scheduleTick(tickMs);

    return new Promise((resolve) => {
      const step = (): void => {
        if (!this.running || this.queue.length === 0 || this.now >= maxTime) {
          this.running = false;
          resolve();
          return;
        }
        const next = this.queue.shift()!;
        this.now = next.at;
        try {
          next.fn();
        } catch (e) {
          console.error('sim error', e);
        }
        if (this.queue.length % 20 === 0) setImmediate(step);
        else step();
      };
      setImmediate(step);
    });
  }

  private _announceContacts(): void {
    for (const c of this.contacts) {
      for (const [o, cl] of c.windows) {
        if (Math.abs(this.now - o) < 1) {
          this.log(this.now, 'CONTACT', `${c.a}↔${c.b}`, `OPEN until t=${cl}`);
        }
        if (Math.abs(this.now - cl) < 1) {
          this.log(this.now, 'CONTACT', `${c.a}↔${c.b}`, `CLOSE`);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    this.queue = [];
  }

  /** Load topology + contacts from a contact-plan JSON object. */
  loadContactPlan(plan: ContactPlanJson): void {
    for (const n of plan.nodes) {
      this.addNode(new Node(n.name, n.nextHop, n.role ?? 'hybrid'));
    }
    for (const c of plan.contacts) {
      this.addContact(
        createContact(c.a, c.b, c.windows, c.delayMs, c.bandwidthBps)
      );
    }
  }
}
