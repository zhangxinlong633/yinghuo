import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { inspectBundle } from '../bp/bp-codec';
import { toWireBundle, WireEncodeError } from '../bp/wire';
import type {
  DeliveredMessage,
  RelayBundle,
  RelayBundleOpsDetail,
  RelayStatus,
} from './bundle.types';
import {
  acceptIngest,
  applyAck,
  createBundle,
  markExpired,
  noteForwardFailed,
  shouldRetry,
  type BundleEvent,
  type TrackedBundle,
} from './bundle-machine';
import { ContactService } from '../contact/contact.service';
import {
  pickReplicaTargets,
  replicaCount,
  replicaStrategy,
  type ReplicaCandidate,
} from './replica-select';
import { peerUrlFor, type RelayRuntimeConfig } from '../config';
import { GraphService } from '../graph/graph.service';
import type { RouteDecision } from '../graph/graph-route';
import { contactGraphRoute, localGraphFromPlan } from '../graph/graph-cgr';
import { localRegion, localTier, parseTier, regionEnabled } from '../graph/region-policy';
import { describeMissionClock } from '../clock/mission-clock';
import { roleCapabilities, roleRoutePenalty } from '../role/role-policy';
import { LevelStore } from '../store/level-store';
import { PeerService } from '../peer/peer.service';
import { RELAY_CONFIG } from '../relay.tokens';
import { payloadHashOk, payloadSha256 } from './payload-hash';
import { canPromoteReplica, replicaPromoteEnabled } from './replica-promote';

let seq = 0;

function newBundleId(nodeId: string): string {
  return `${nodeId}-B${Date.now()}-${++seq}`;
}

function toTracked(bundle: RelayBundle): TrackedBundle {
  return {
    id: bundle.id,
    src: bundle.src,
    dst: bundle.dst,
    payload: bundle.payload,
    createdAt: bundle.createdAt,
    ttlMs: bundle.ttlMs,
    state: bundle.state ?? 'WAITING',
    custodian: bundle.custodian ?? bundle.src,
    hops: bundle.hops ?? [],
    events: (bundle.events ?? []) as BundleEvent[],
  };
}

function fromTracked(
  tracked: TrackedBundle,
  delivered: boolean,
  wire?: string,
  orig?: RelayBundle,
): RelayBundle {
  return {
    id: tracked.id,
    src: tracked.src,
    dst: tracked.dst,
    payload: tracked.payload,
    createdAt: tracked.createdAt,
    ttlMs: tracked.ttlMs,
    hops: tracked.hops,
    delivered,
    state: tracked.state,
    custodian: tracked.custodian,
    events: tracked.events,
    ...(wire !== undefined ? { wire } : orig?.wire ? { wire: orig.wire } : {}),
    ...(orig?.replicaRole ? { replicaRole: orig.replicaRole } : {}),
    ...(orig?.replicaOf ? { replicaOf: orig.replicaOf } : {}),
    ...(orig?.replicas ? { replicas: orig.replicas } : {}),
    ...(orig?.payloadSha256 ? { payloadSha256: orig.payloadSha256 } : {}),
    ...(orig?.dstRegion ? { dstRegion: orig.dstRegion } : {}),
  };
}

function routeNote(decision: RouteDecision): string {
  if (decision.algo === 'cgr' && decision.path && decision.path.length > 0) {
    return `selected ${decision.nextHop} via CGR ${decision.path.join('→')}`;
  }
  const culled = decision.culled.map((candidate) => candidate.neighbor).join(', ');
  return culled.length > 0
    ? `selected ${decision.nextHop}; culled ${culled}`
    : `selected ${decision.nextHop}`;
}

function lastRetryAt(events: RelayBundle['events']): number | null {
  if (!events || events.length === 0) return null;
  let last: number | null = null;
  for (const event of events) {
    if (event.kind === 'RETRY') last = event.t;
  }
  return last;
}

interface PendingAck {
  bundleId: string;
  upstream: string;
  events: BundleEvent[];
}

/** HTTP forward planned under the lock and performed after the lock is released. */
interface ForwardJob {
  bundleId: string;
  next: string;
  bundle: RelayBundle;
}

@Injectable()
export class BundleService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BundleService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: Array<{ t: number; event: string; msg: string }> = [];
  private lastContactOpen: boolean | null = null;
  /** Process-local pacing for forward attempts, including successful resends. */
  private readonly lastForwardAttempt = new Map<string, number>();
  /** Bundle ids whose HTTP forward has not settled. Blocks a second forwardTo. */
  private readonly forwardsInFlight = new Set<string>();
  /** Upstream acks held until the return contact opens. */
  private readonly pendingAcks: PendingAck[] = [];
  /** Serializes send, ingest, ack, and tick so store writes cannot interleave. */
  private opChain: Promise<void> = Promise.resolve();
  /** True while a tick is queued or running; interval ticks do not stack. */
  private tickQueued = false;
  /**
   * Bundle ids this process has seen. Capped at 100.
   * Survives ACK so a released bundle stays listable until restart or eviction.
   */
  private readonly recent: string[] = [];
  private static readonly RECENT_CAP = 100;

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.opChain.then(work, work);
    this.opChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Inject(LevelStore) private readonly store: LevelStore,
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(PeerService) private readonly peer: PeerService,
    @Optional() @Inject(GraphService) private readonly graph?: GraphService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.tick();
    }, 500);
    this.pushEvent('BOOT', `relay ${this.cfg.nodeId} ready peer=${this.cfg.peerUrl}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private pushEvent(event: string, msg: string): void {
    const row = { t: Date.now(), event, msg };
    this.events.push(row);
    if (this.events.length > 200) this.events.shift();
    this.log.log(`${event} ${msg}`);
  }

  /** Ops timeline entry for ingest rejects that never reach custody. */
  recordOps(event: string, msg: string): void {
    this.pushEvent(event, msg);
  }

  async send(
    dst: string,
    payload: string,
    ttlMs = 120000,
    dstRegion?: string,
  ): Promise<RelayBundle> {
    const staged = await this.enqueue(() => this.stageSend(dst, payload, ttlMs, dstRegion));
    if (staged.job) await this.finishForward(staged.job);
    await this.replicate(staged.bundle.id, [
      ...(staged.job?.next ? [staged.job.next] : []),
      staged.bundle.dst,
    ]);
    return this.enqueue(async () => (await this.store.getBundle(staged.bundle.id)) ?? staged.bundle);
  }

  private async stageSend(
    dst: string,
    payload: string,
    ttlMs: number,
    dstRegion?: string,
  ): Promise<{ bundle: RelayBundle; job: ForwardJob | null }> {
    if (!roleCapabilities(this.cfg.role).canInject) {
      throw new Error(`role=${this.cfg.role} cannot inject application traffic`);
    }
    const now = Date.now();
    const id = newBundleId(this.cfg.nodeId);
    const picked = this.pickNext(dst, now, dstRegion);
    const contactOpen = picked.next !== null && this.contacts.isOpenTo(picked.next, now);
    const draft: RelayBundle = {
      id,
      src: this.cfg.nodeId,
      dst,
      payload,
      createdAt: now,
      ttlMs,
      hops: [],
      delivered: false,
    };
    // Encode before any FORWARDING write. Failure throws and stores nothing.
    const wire = this.encodeWire(draft);
    const tracked = createBundle({
      id,
      src: this.cfg.nodeId,
      dst,
      payload,
      createdAt: now,
      ttlMs,
      contactOpen,
    });
    const bundle = fromTracked(tracked, false, wire);
    bundle.replicaRole = 'primary';
    bundle.payloadSha256 = payloadSha256(payload);
    if (dstRegion?.trim()) bundle.dstRegion = dstRegion.trim();
    bundle.replicas = [];
    await this.store.putBundle(bundle);
    await this.store.putCustody({
      bundleId: bundle.id,
      waitingAck: false,
      from: null,
      heldAt: now,
    });
    this.rememberBundle(bundle.id);
    this.pushEvent('CREATE', `${bundle.id} ${bundle.src}→${bundle.dst} "${payload}"`);
    this.pushEvent('STORE', `${bundle.id} custody held (await contact)`);
    const job = await this.prepareForward(bundle.id);
    return { bundle, job };
  }

  /** Peer CLA ingest — called when the arrival contact is open and a peer pushes a bundle. */
  async ingestFromPeer(
    bundle: RelayBundle,
    from: string,
    replica = false,
  ): Promise<{
    accepted: boolean;
    delivered: boolean;
    duplicate?: boolean;
    event: string;
    msg: string;
  }> {
    const result = await this.enqueue(() => this.ingestFromPeerExclusive(bundle, from, replica));
    if (!replica && result.accepted && !result.duplicate) {
      await this.replicate(bundle.id, [from, bundle.dst]);
    }
    return result;
  }

  private async ingestFromPeerExclusive(
    bundle: RelayBundle,
    from: string,
    replica = false,
  ): Promise<{
    accepted: boolean;
    delivered: boolean;
    duplicate?: boolean;
    event: string;
    msg: string;
  }> {
    this.rememberBundle(bundle.id);
    const existing = await this.store.getBundle(bundle.id);
    if (existing) {
      if (!replica) this.queuePendingAck(existing.id, from, existing.events ?? []);
      return {
        accepted: true,
        delivered: existing.delivered,
        duplicate: true,
        event: 'DUPLICATE',
        msg: `${bundle.id} duplicate`,
      };
    }

    const now = Date.now();

    if (replica) {
      if (bundle.payloadSha256 && !payloadHashOk(bundle.payload, bundle.payloadSha256)) {
        const stored: RelayBundle = {
          ...bundle,
          replicaRole: 'replica',
          replicaOf: from,
          custodian: from,
          replicas: [],
          delivered: false,
          state: 'WAITING',
          events: [
            ...(bundle.events ?? []),
            { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
          ],
        };
        await this.store.putBundle(stored);
        this.pushEvent('CORRUPT', `${stored.id} replica payload mismatch`);
        return {
          accepted: true,
          delivered: false,
          event: 'CORRUPT',
          msg: `${stored.id} corrupt replica`,
        };
      }
      const stored: RelayBundle = {
        ...bundle,
        replicaRole: 'replica',
        replicaOf: from,
        custodian: from,
        replicas: [],
        delivered: false,
        state: 'WAITING',
        events: [
          ...(bundle.events ?? []),
          { t: now, node: this.cfg.nodeId, kind: 'REPLICA_STORE', msg: `replica of ${from}` },
        ],
      };
      await this.store.putBundle(stored);
      this.pushEvent('REPLICA_STORE', `${stored.id} from=${from}`);
      return {
        accepted: true,
        delivered: false,
        event: 'REPLICA_STORE',
        msg: `${stored.id} replica stored`,
      };
    }

    if (bundle.dst === this.cfg.nodeId) {
      if (bundle.payloadSha256 && !payloadHashOk(bundle.payload, bundle.payloadSha256)) {
        const stored: RelayBundle = {
          ...bundle,
          delivered: false,
          state: 'WAITING',
          events: [
            ...(bundle.events ?? []),
            { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
          ],
        };
        await this.store.putBundle(stored);
        this.pushEvent('CORRUPT', `${stored.id} payload mismatch`);
        return {
          accepted: true,
          delivered: false,
          event: 'CORRUPT',
          msg: `${stored.id} corrupt payload`,
        };
      }
      const accepted = acceptIngest(undefined, toTracked(bundle), now, this.cfg.nodeId, true);
      const stored = fromTracked(accepted, true, bundle.wire, bundle);
      await this.store.putBundle(stored);
      const msg: DeliveredMessage = {
        id: stored.id,
        src: stored.src,
        dst: stored.dst,
        payload: stored.payload,
        deliveredAt: now,
        hops: stored.hops,
      };
      await this.store.deliverLocal(msg);
      this.pushEvent('DELIVER', `${stored.id} payload="${stored.payload}" from=${stored.src}`);
      this.queuePendingAck(stored.id, from, stored.events ?? []);
      return {
        accepted: true,
        delivered: true,
        event: 'DELIVER',
        msg: `${stored.id} delivered locally`,
      };
    }

    if (!roleCapabilities(this.cfg.role).canRelay) {
      this.pushEvent(
        'REJECT',
        `${bundle.id} role=${this.cfg.role} refuses to relay (dst=${bundle.dst})`,
      );
      return {
        accepted: false,
        delivered: false,
        event: 'REJECT',
        msg: `${this.cfg.role} will not store-and-forward for others`,
      };
    }

    const accepted = acceptIngest(undefined, toTracked(bundle), now, this.cfg.nodeId, false);
    const stored = fromTracked(accepted, false, bundle.wire, bundle);
    await this.store.putBundle(stored);
    await this.store.putCustody({
      bundleId: stored.id,
      waitingAck: false,
      from,
      heldAt: now,
    });
    this.pushEvent('STORE', `${stored.id} from=${from} →${stored.dst}`);
    this.queuePendingAck(stored.id, from, stored.events ?? []);
    return {
      accepted: true,
      delivered: false,
      event: 'STORE',
      msg: `${stored.id} stored`,
    };
  }

  async onAck(bundleId: string, from: string, downstreamEvents: BundleEvent[] = []): Promise<void> {
    return this.enqueue(() => this.onAckExclusive(bundleId, from, downstreamEvents));
  }

  private async onAckExclusive(
    bundleId: string,
    from: string,
    downstreamEvents: BundleEvent[]
  ): Promise<void> {
    this.rememberBundle(bundleId);
    const bundle = await this.store.getBundle(bundleId);
    if (!bundle) return;
    const now = Date.now();
    const custody = await this.store.getCustody(bundleId);
    const upstream = custody?.from ?? null;
    const acked = applyAck(toTracked(bundle), now, this.cfg.nodeId, from, downstreamEvents);
    await this.store.putBundle(fromTracked(acked, bundle.delivered, bundle.wire, bundle));
    this.pushEvent('ACK', `${bundleId} acked by ${from} — release custody`);
    this.lastForwardAttempt.delete(bundleId);
    if (custody) await this.store.releaseCustody(bundleId);
    if (upstream) this.queuePendingAck(bundleId, upstream, acked.events);
  }

  /** Record an ack to send later. Caller must hold the bundle mutex. */
  private queuePendingAck(bundleId: string, upstream: string, events: BundleEvent[]): void {
    this.pendingAcks.push({ bundleId, upstream, events });
  }

  /** Detach acks whose return contact is open. Caller must hold the bundle mutex. */
  private takeSendableAcks(now: number): PendingAck[] {
    const ready: PendingAck[] = [];
    const keep: PendingAck[] = [];
    for (const pending of this.pendingAcks) {
      if (this.contacts.isOpenTo(pending.upstream, now)) ready.push(pending);
      else keep.push(pending);
    }
    this.pendingAcks.length = 0;
    this.pendingAcks.push(...keep);
    return ready;
  }

  private async flushAcksOutside(acks: PendingAck[]): Promise<void> {
    const failed: PendingAck[] = [];
    for (const pending of acks) {
      const sent = await this.peer.sendAck(
        this.peer.urlFor(pending.upstream),
        pending.bundleId,
        pending.events
      );
      if (!sent) failed.push(pending);
    }
    if (failed.length > 0) {
      await this.enqueue(async () => {
        this.pendingAcks.push(...failed);
      });
    }
  }

  private async prepareForward(bundleId: string): Promise<ForwardJob | null> {
    if (this.forwardsInFlight.has(bundleId)) return null;
    const custody = await this.store.getCustody(bundleId);
    if (!custody) return null;
    let bundle = await this.store.getBundle(bundleId);
    if (!bundle || bundle.delivered) return null;
    if (bundle.state === 'ACKED' || bundle.state === 'EXPIRED' || bundle.state === 'ARRIVED') return null;

    const now = Date.now();
    if (now - bundle.createdAt >= bundle.ttlMs) {
      const expired = markExpired(toTracked(bundle), now, this.cfg.nodeId);
      this.rememberBundle(bundleId);
      await this.store.putBundle(fromTracked(expired, bundle.delivered, bundle.wire, bundle));
      await this.store.releaseCustody(bundleId);
      this.store.dropInbox(bundleId);
      this.lastForwardAttempt.delete(bundleId);
      this.pushEvent('EXPIRE', `${bundleId} TTL exceeded — drop`);
      return null;
    }

    if (bundle.payloadSha256 && !payloadHashOk(bundle.payload, bundle.payloadSha256)) {
      if (!(bundle.events ?? []).some((e) => e.kind === 'CORRUPT')) {
        await this.store.putBundle({
          ...bundle,
          events: [
            ...(bundle.events ?? []),
            { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
          ],
        });
        this.pushEvent('CORRUPT', `${bundleId} payload mismatch`);
      }
      return null;
    }

    if (this.encodeRejected(bundle)) return null;

    const picked = this.pickNext(bundle.dst, now, bundle.dstRegion);
    if (picked.next === null) {
      await this.recordRoute(bundle, now, picked.routeMsg ?? 'no next hop', true);
      if (custody.waitingAck) {
        custody.waitingAck = false;
        await this.store.putCustody(custody);
      }
      return null;
    }
    const next = picked.next;
    if (picked.routeMsg) bundle = await this.recordRoute(bundle, now, picked.routeMsg, false);
    const contactOpen = this.contacts.isOpenTo(next, now);

    if (custody.waitingAck) {
      if (!contactOpen) return null;
      if (!shouldRetry(this.lastForwardAttempt.get(bundleId) ?? null, now)) return null;
      if (this.forwardsInFlight.has(bundleId)) return null;
      const wired = await this.wireBeforeForward(bundle);
      if (!wired) return null;
      this.forwardsInFlight.add(bundleId);
      this.lastForwardAttempt.set(bundleId, now);
      if (wired.wire !== bundle.wire) await this.store.putBundle(wired);
      return { bundleId, next, bundle: wired };
    }

    if (!shouldRetry(lastRetryAt(bundle.events), now)) return null;

    if (!contactOpen) {
      if (bundle.state !== 'WAITING') {
        const waiting: RelayBundle = {
          ...bundle,
          state: 'WAITING',
          events: [
            ...(bundle.events ?? []),
            { t: now, node: this.cfg.nodeId, kind: 'WAITING', msg: 'WAITING' },
          ],
        };
        await this.store.putBundle(waiting);
      }
      return null;
    }

    const wired = await this.wireBeforeForward(bundle);
    if (!wired) return null;

    const forwarding: RelayBundle = {
      ...wired,
      state: 'FORWARDING',
      hops: [...wired.hops, { from: this.cfg.nodeId, to: next, at: now }],
      events: [
        ...(wired.events ?? []),
        { t: now, node: this.cfg.nodeId, kind: 'FORWARD', msg: 'FORWARDING' },
      ],
    };
    this.lastForwardAttempt.set(bundleId, now);
    custody.waitingAck = true;
    await this.store.putCustody(custody);
    await this.store.putBundle(forwarding);
    this.forwardsInFlight.add(bundleId);
    this.pushEvent('FORWARD', `${bundleId} → ${next} (contact open)`);
    return { bundleId, next, bundle: forwarding };
  }

  private replicaPeerIds(): string[] {
    const ids = new Set(Object.keys(this.cfg.peers));
    for (const id of this.graph?.listDirectPeerIds() ?? []) ids.add(id);
    return [...ids];
  }

  private replicaCandidates(): ReplicaCandidate[] {
    const me = this.cfg.nodeId;
    const snap = this.graph?.snapshot();
    const selfNode = snap?.nodes.find((n) => n.id === me);
    const sx = selfNode?.x ?? this.cfg.x;
    const sy = selfNode?.y ?? this.cfg.y;
    const unhealthy = new Set(this.graph?.listUnhealthy() ?? []);
    return this.replicaPeerIds().flatMap((id) => {
      const node = snap?.nodes.find((n) => n.id === id);
      const planNode = this.cfg.plan.nodes.find((n) => n.name === id);
      const x = node?.x ?? planNode?.x ?? 0;
      const y = node?.y ?? planNode?.y ?? 0;
      const edge = snap?.edges.find(
        (e) =>
          e.direct &&
          ((e.a === me && e.b === id) || (e.b === me && e.a === id)),
      );
      const contact = this.cfg.plan.contacts.find(
        (c) => (c.a === me && c.b === id) || (c.b === me && c.a === id),
      );
      const delayMs = edge?.delayMs ?? contact?.delayMs ?? Number.POSITIVE_INFINITY;
      const role = node?.role ?? this.cfg.roleByNode[id] ?? 'lander';
      if (regionEnabled()) {
        if (parseTier(node?.tier, role) !== 'backbone') return [];
        if ((node?.region ?? localRegion()) !== localRegion()) return [];
      }
      return [{
        id,
        dist: Math.hypot(x - sx, y - sy),
        delayMs,
        unhealthy: unhealthy.has(id),
        rolePenalty: roleRoutePenalty(this.cfg.role, role),
      }];
    });
  }

  /** Copy the bundle to up to DTN_REPLICA_N (default 2) other nodes. Replicas do not take custody. */
  async replicate(bundleId: string, exclude: string[] = []): Promise<void> {
    const n = replicaCount(process.env, {
      partitioning: regionEnabled(),
      tier: localTier(process.env, this.cfg.role),
    });
    if (n <= 0 || !this.peer) return;
    const strategy = replicaStrategy();
    const bundle = await this.enqueue(async () => this.store.getBundle(bundleId));
    if (!bundle || bundle.replicaRole === 'replica') return;
    const targets = pickReplicaTargets({
      self: this.cfg.nodeId,
      peers: this.replicaCandidates(),
      exclude,
      n,
      strategy,
    });
    for (const hop of targets) {
      const url = peerUrlFor(this.cfg, hop, this.graph);
      if (!url) continue;
      const result = await this.peer.forwardTo(url, bundle, {
        'x-dtn-replica': '1',
        'x-dtn-force': '1',
      });
      await this.enqueue(async () => {
        const current = await this.store.getBundle(bundleId);
        if (!current) return;
        if (result.ok) {
          const replicas = [...new Set([...(current.replicas ?? []), hop])];
          await this.store.putBundle({ ...current, replicas });
          this.pushEvent('REPLICA', `${bundleId} → ${hop} (${strategy})`);
        } else {
          this.pushEvent('REPLICA_FAIL', `${bundleId} → ${hop} ${result.error ?? ''}`.trim());
        }
      });
    }
  }

  /** Peer HTTP. Must run while the bundle mutex is not held. */
  private async finishForward(job: ForwardJob): Promise<void> {
    let result: {
      ok: boolean;
      error?: string;
      wireBase64?: string;
      permanentEncode?: boolean;
    };
    try {
      result = await this.peer.forwardTo(this.peer.urlFor(job.next), job.bundle);
    } finally {
      this.forwardsInFlight.delete(job.bundleId);
    }
    if (result.wireBase64) {
      const wireBase64 = result.wireBase64;
      await this.enqueue(async () => {
        const current = await this.store.getBundle(job.bundleId);
        if (current) await this.store.putBundle({ ...current, wire: wireBase64 });
      });
    }
    if (!result.ok) {
      if (result.permanentEncode) {
        await this.enqueue(() => this.abandonEncode(job.bundleId, result.error ?? 'encode failed'));
      } else {
        if (this.cfg.graphMode) this.graph?.markUnhealthy(job.next);
        await this.enqueue(() => this.applyForwardFailure(job.bundleId, result.error));
      }
    }
  }

  /** Static table, else CGR over the plan contacts, else dst itself. */
  private pickNext(
    dst: string,
    now: number,
    dstRegion?: string,
  ): { next: string | null; routeMsg: string | null } {
    if (this.cfg.graphMode && this.graph) {
      const decision = this.graph.decide(dst, now, dstRegion);
      if (!decision.nextHop) return { next: null, routeMsg: decision.reason };
      return { next: decision.nextHop, routeMsg: routeNote(decision) };
    }
    const table = this.cfg.nextHop[dst];
    if (process.env.DTN_CGR !== '0' && process.env.DTN_CGR !== 'false') {
      const planGraph = localGraphFromPlan(this.cfg.plan);
      const peerIds = [
        ...new Set(
          this.cfg.plan.contacts
            .filter((c) => c.a === this.cfg.nodeId || c.b === this.cfg.nodeId)
            .map((c) => (c.a === this.cfg.nodeId ? c.b : c.a)),
        ),
      ];
      const cgr = contactGraphRoute({
        me: this.cfg.nodeId,
        dst,
        graph: planGraph,
        peerIds,
        unhealthy: new Set(),
        now,
        meRole: this.cfg.role,
      });
      if (cgr.nextHop) {
        return { next: cgr.nextHop, routeMsg: cgr.reason };
      }
    }
    return { next: table ?? dst, routeMsg: null };
  }

  /** Persist a ROUTE line once per distinct reason. A null next hop parks WAITING. */
  private async recordRoute(
    bundle: RelayBundle,
    now: number,
    msg: string,
    parkWaiting: boolean,
  ): Promise<RelayBundle> {
    const events = bundle.events ?? [];
    const lastRoute = [...events].reverse().find((event) => event.kind === 'ROUTE');
    const state = parkWaiting ? 'WAITING' : (bundle.state ?? 'WAITING');
    if (lastRoute?.msg === msg && (bundle.state ?? 'WAITING') === state) return bundle;
    const updated: RelayBundle = {
      ...bundle,
      state,
      events: [...events, { t: now, node: this.cfg.nodeId, kind: 'ROUTE', msg }],
    };
    await this.store.putBundle(updated);
    this.pushEvent('ROUTE', `${bundle.id} ${msg}`);
    return updated;
  }

  /** Cached BPv7 bytes, or a fresh encode. Throws WireEncodeError; does not touch state. */
  private encodeWire(bundle: RelayBundle): string {
    if (bundle.wire) return bundle.wire;
    return toWireBundle(bundle, this.cfg).toString('base64');
  }

  /**
   * Encode before the FORWARDING write. Permanent failure stays out of FORWARDING
   * and is not retried on later contact windows.
   */
  private async wireBeforeForward(bundle: RelayBundle): Promise<RelayBundle | null> {
    if (this.encodeRejected(bundle)) return null;
    try {
      const wire = this.encodeWire(bundle);
      return wire === bundle.wire ? bundle : { ...bundle, wire };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.abandonEncode(bundle.id, msg);
      return null;
    }
  }

  private encodeRejected(bundle: RelayBundle): boolean {
    return (bundle.events ?? []).some((event) => event.kind === 'ENCODE_FAIL');
  }

  /** Record a permanent encode failure. State stays off FORWARDING; custody is not a retry loop. */
  private async abandonEncode(bundleId: string, reason: string): Promise<void> {
    const stored = await this.store.getBundle(bundleId);
    if (!stored) return;
    if (stored.state === 'ACKED' || stored.state === 'EXPIRED' || stored.state === 'ARRIVED') return;
    const now = Date.now();
    const already = this.encodeRejected(stored);
    await this.store.putBundle({
      ...stored,
      state: 'WAITING',
      events: already
        ? stored.events
        : [
            ...(stored.events ?? []),
            { t: now, node: this.cfg.nodeId, kind: 'ENCODE_FAIL', msg: reason },
          ],
    });
    const custody = await this.store.getCustody(bundleId);
    if (custody?.waitingAck) {
      custody.waitingAck = false;
      await this.store.putCustody(custody);
    }
    this.lastForwardAttempt.delete(bundleId);
    if (!already) this.pushEvent('ENCODE_FAIL', `${bundleId} ${reason}`);
  }

  /** Re-read after HTTP. Only WAITING + clear waitingAck while still FORWARDING with custody. */
  private async applyForwardFailure(bundleId: string, error: string | undefined): Promise<void> {
    if (this.forwardsInFlight.has(bundleId)) return;
    const stored = await this.store.getBundle(bundleId);
    const custody = await this.store.getCustody(bundleId);
    if (!stored || !custody) return;
    if (stored.state !== 'FORWARDING') return;

    const reason = error ?? 'forward failed';
    const failed = noteForwardFailed(toTracked(stored), Date.now(), this.cfg.nodeId, reason);
    await this.store.putBundle(fromTracked(failed, stored.delivered, stored.wire, stored));
    custody.waitingAck = false;
    await this.store.putCustody(custody);
    this.pushEvent('RETRY', `${bundleId} forward failed: ${reason}`);
  }

  private tick(): void {
    if (this.tickQueued) return;
    this.tickQueued = true;
    void this.runTick()
      .catch((err: unknown) => {
        this.log.error(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        this.tickQueued = false;
      });
  }

  private async runTick(): Promise<void> {
    const planned = await this.enqueue(() => this.planTick());
    await this.flushAcksOutside(planned.acks);
    for (const job of planned.forwards) {
      await this.finishForward(job);
    }
  }

  private async planTick(): Promise<{ acks: PendingAck[]; forwards: ForwardJob[] }> {
    const open = this.contacts.isOpen();
    if (this.lastContactOpen === null || this.lastContactOpen !== open) {
      const st = this.contacts.getState();
      this.pushEvent(
        'CONTACT',
        `${this.cfg.nodeId}↔${st.peer} ${open ? 'OPEN' : 'CLOSE'} — ${st.phase}`
      );
      this.lastContactOpen = open;
    }
    const now = Date.now();
    const acks = this.takeSendableAcks(now);
    await this.promoteReplicas();
    const ids = await this.store.listPendingBundleIds();
    const forwards: ForwardJob[] = [];
    for (const id of ids) {
      try {
        const job = await this.prepareForward(id);
        if (job) forwards.push(job);
      } catch (err: unknown) {
        if (err instanceof WireEncodeError) continue;
        throw err;
      }
    }
    await this.expireDeliveredInbox(now);
    return { acks, forwards };
  }

  private async promoteReplicas(): Promise<void> {
    const promoteEnabled = replicaPromoteEnabled();
    const unhealthyIds = this.graph?.listUnhealthy() ?? [];
    const ids = await this.store.listBundleIds();
    for (const id of ids) {
      const bundle = await this.store.getBundle(id);
      if (!bundle) continue;
      const decision = canPromoteReplica({
        replicaRole: bundle.replicaRole,
        replicaOf: bundle.replicaOf,
        payload: bundle.payload,
        payloadSha256: bundle.payloadSha256,
        unhealthyIds,
        promoteEnabled,
      });
      if (!decision.ok) {
        if (
          decision.reason === 'corrupt' &&
          !(bundle.events ?? []).some((e) => e.kind === 'CORRUPT')
        ) {
          const now = Date.now();
          await this.store.putBundle({
            ...bundle,
            events: [
              ...(bundle.events ?? []),
              { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
            ],
          });
          this.pushEvent('CORRUPT', `${bundle.id} payload mismatch`);
        }
        continue;
      }
      const now = Date.now();
      await this.store.putCustody({
        bundleId: bundle.id,
        waitingAck: false,
        from: null,
        heldAt: now,
      });
      const promoted: RelayBundle = {
        ...bundle,
        replicaRole: 'primary',
        custodian: this.cfg.nodeId,
        events: [
          ...(bundle.events ?? []),
          { t: now, node: this.cfg.nodeId, kind: 'PROMOTE', msg: `custody from ${bundle.replicaOf}` },
        ],
      };
      await this.store.putBundle(promoted);
      this.rememberBundle(promoted.id);
      this.pushEvent('PROMOTE', `${promoted.id} was ${bundle.replicaOf}`);
    }
  }

  /**
   * Destination delivery does not take custody, so TTL must be applied to the
   * local inbox itself. A payload still sitting unread is voided when it expires.
   */
  private async expireDeliveredInbox(now: number): Promise<void> {
    for (const msg of this.store.peekInbox()) {
      const carried = msg as DeliveredMessage & { createdAt?: number; ttlMs?: number };
      let createdAt = carried.createdAt;
      let ttlMs = carried.ttlMs;
      const bundle = await this.store.getBundle(msg.id);
      if (createdAt === undefined || ttlMs === undefined) {
        if (!bundle) {
          this.store.dropInbox(msg.id);
          continue;
        }
        createdAt = bundle.createdAt;
        ttlMs = bundle.ttlMs;
      }
      if (now - createdAt < ttlMs) continue;

      if (bundle && bundle.state !== 'EXPIRED') {
        const expired = markExpired(toTracked(bundle), now, this.cfg.nodeId);
        await this.store.putBundle(fromTracked(expired, bundle.delivered, bundle.wire, bundle));
      }
      this.store.dropInbox(msg.id);
      this.rememberBundle(msg.id);
      this.pushEvent('EXPIRE', `${msg.id} TTL exceeded — drop inbox`);
    }
  }

  /** Most recently touched first. Custody-only ids (after restart) follow. */
  async listBundles(): Promise<
    Array<{
      id: string;
      src: string;
      dst: string;
      state: string;
      custodian: string;
      updatedAt: number;
    }>
  > {
    return this.enqueue(() => this.listBundlesExclusive());
  }

  async getBundle(id: string): Promise<RelayBundleOpsDetail | undefined> {
    return this.enqueue(async () => {
      const bundle = await this.store.getBundle(id);
      if (!bundle) return undefined;
      if (!bundle.wire) return bundle;
      const wireBuf = Buffer.from(bundle.wire, 'base64');
      return {
        ...bundle,
        wireLength: wireBuf.length,
        primary: inspectBundle(wireBuf),
      };
    });
  }

  private rememberBundle(id: string): void {
    const idx = this.recent.indexOf(id);
    if (idx >= 0) this.recent.splice(idx, 1);
    this.recent.push(id);
    if (this.recent.length > BundleService.RECENT_CAP) {
      this.recent.splice(0, this.recent.length - BundleService.RECENT_CAP);
    }
  }

  private async listBundlesExclusive(): Promise<
    Array<{
      id: string;
      src: string;
      dst: string;
      state: string;
      custodian: string;
      updatedAt: number;
    }>
  > {
    const [custodyIds, storedIds] = await Promise.all([
      this.store.listPendingBundleIds(),
      this.store.listBundleIds(),
    ]);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const id = this.recent[i];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    for (const id of custodyIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    for (const id of storedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    const rows: Array<{
      id: string;
      src: string;
      dst: string;
      state: string;
      custodian: string;
      updatedAt: number;
    }> = [];
    for (const id of ids) {
      const bundle = await this.store.getBundle(id);
      if (!bundle) continue;
      const events = bundle.events ?? [];
      const updatedAt = events.length > 0 ? events[events.length - 1].t : bundle.createdAt;
      rows.push({
        id: bundle.id,
        src: bundle.src,
        dst: bundle.dst,
        state: bundle.state ?? '',
        custodian: bundle.custodian ?? '',
        updatedAt,
      });
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice(0, BundleService.RECENT_CAP);
  }

  recv(clear = true): DeliveredMessage[] {
    return this.store.pollInbox(clear);
  }

  peekInbox(): DeliveredMessage[] {
    return this.store.peekInbox();
  }

  async status(): Promise<RelayStatus> {
    const counts = await this.store.counts();
    const contact = this.contacts.getState();
    const caps = roleCapabilities(this.cfg.role);
    return {
      nodeId: this.cfg.nodeId,
      role: this.cfg.role,
      missionRole: caps.mission,
      capabilities: {
        canInject: caps.canInject,
        canRelay: caps.canRelay,
      },
      custodySemantics: caps.custodySemantics,
      routeBias: caps.routeBias,
      plan: this.cfg.planStatus,
      port: this.cfg.port,
      peerUrl: this.cfg.peerUrl,
      uptimeMs: Date.now() - this.cfg.startedAt,
      store: counts,
      dataDir: this.store.getDataDir(),
      contact: {
        peer: contact.peer,
        open: contact.open,
        delayMs: contact.delayMs,
        schedule: contact.schedule,
        nextChangeAt: contact.nextChangeAt,
        phase: contact.phase,
      },
      recentEvents: this.events.slice(-40),
      clock: describeMissionClock(),
      replica: {
        n: replicaCount(process.env, {
          partitioning: regionEnabled(),
          tier: localTier(process.env, this.cfg.role),
        }),
        strategy: replicaStrategy(),
        promote: replicaPromoteEnabled(),
      },
    };
  }
}
