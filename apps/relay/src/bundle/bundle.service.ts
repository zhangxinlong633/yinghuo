import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  DeliveredMessage,
  RelayBundle,
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
import { peerUrlFor, type RelayRuntimeConfig } from '../config';
import { LevelStore } from '../store/level-store';
import { PeerService } from '../peer/peer.service';
import { RELAY_CONFIG } from '../relay.tokens';

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

function fromTracked(tracked: TrackedBundle, delivered: boolean): RelayBundle {
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
  };
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
  /** Upstream acks held until the return contact opens. */
  private readonly pendingAcks: PendingAck[] = [];
  /** Serializes send, ingest, ack, and tick so store writes cannot interleave. */
  private opChain: Promise<void> = Promise.resolve();
  /** True while a tick is queued or running; interval ticks do not stack. */
  private tickQueued = false;

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
    @Inject(PeerService) private readonly peer: PeerService
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

  async send(dst: string, payload: string, ttlMs = 120000): Promise<RelayBundle> {
    const staged = await this.enqueue(() => this.stageSend(dst, payload, ttlMs));
    if (staged.job) await this.finishForward(staged.job);
    return this.enqueue(async () => (await this.store.getBundle(staged.bundle.id)) ?? staged.bundle);
  }

  private async stageSend(
    dst: string,
    payload: string,
    ttlMs: number
  ): Promise<{ bundle: RelayBundle; job: ForwardJob | null }> {
    if (this.cfg.role === 'relay') {
      throw new Error('role=relay cannot inject application traffic');
    }
    const now = Date.now();
    const id = newBundleId(this.cfg.nodeId);
    const next = this.cfg.nextHop[dst] ?? dst;
    const contactOpen = this.contacts.isOpenTo(next, now);
    const tracked = createBundle({
      id,
      src: this.cfg.nodeId,
      dst,
      payload,
      createdAt: now,
      ttlMs,
      contactOpen,
    });
    const bundle = fromTracked(tracked, false);
    await this.store.putBundle(bundle);
    await this.store.putCustody({
      bundleId: bundle.id,
      waitingAck: false,
      from: null,
      heldAt: now,
    });
    this.pushEvent('CREATE', `${bundle.id} ${bundle.src}→${bundle.dst} "${payload}"`);
    this.pushEvent('STORE', `${bundle.id} custody held (await contact)`);
    const job = await this.prepareForward(bundle.id);
    return { bundle, job };
  }

  /** Peer CLA ingest — called when the arrival contact is open and a peer pushes a bundle. */
  async ingestFromPeer(
    bundle: RelayBundle,
    from: string
  ): Promise<{
    accepted: boolean;
    delivered: boolean;
    duplicate?: boolean;
    event: string;
    msg: string;
  }> {
    return this.enqueue(() => this.ingestFromPeerExclusive(bundle, from));
  }

  private async ingestFromPeerExclusive(
    bundle: RelayBundle,
    from: string
  ): Promise<{
    accepted: boolean;
    delivered: boolean;
    duplicate?: boolean;
    event: string;
    msg: string;
  }> {
    const existing = await this.store.getBundle(bundle.id);
    if (existing) {
      this.queuePendingAck(existing.id, from, existing.events ?? []);
      return {
        accepted: true,
        delivered: existing.delivered,
        duplicate: true,
        event: 'DUPLICATE',
        msg: `${bundle.id} duplicate`,
      };
    }

    const now = Date.now();

    if (bundle.dst === this.cfg.nodeId) {
      const accepted = acceptIngest(undefined, toTracked(bundle), now, this.cfg.nodeId, true);
      const stored = fromTracked(accepted, true);
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

    if (this.cfg.role === 'endpoint') {
      this.pushEvent('REJECT', `${bundle.id} role=endpoint refuses to relay (dst=${bundle.dst})`);
      return {
        accepted: false,
        delivered: false,
        event: 'REJECT',
        msg: 'endpoint will not store-and-forward for others',
      };
    }

    const accepted = acceptIngest(undefined, toTracked(bundle), now, this.cfg.nodeId, false);
    const stored = fromTracked(accepted, false);
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
    const bundle = await this.store.getBundle(bundleId);
    if (!bundle) return;
    const now = Date.now();
    const custody = await this.store.getCustody(bundleId);
    const upstream = custody?.from ?? null;
    const acked = applyAck(toTracked(bundle), now, this.cfg.nodeId, from, downstreamEvents);
    await this.store.putBundle(fromTracked(acked, bundle.delivered));
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
        peerUrlFor(this.cfg, pending.upstream),
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
    const custody = await this.store.getCustody(bundleId);
    if (!custody) return null;
    const bundle = await this.store.getBundle(bundleId);
    if (!bundle || bundle.delivered) return null;
    if (bundle.state === 'ACKED' || bundle.state === 'EXPIRED' || bundle.state === 'ARRIVED') return null;

    const now = Date.now();
    if (now - bundle.createdAt >= bundle.ttlMs) {
      const expired = markExpired(toTracked(bundle), now, this.cfg.nodeId);
      await this.store.putBundle(fromTracked(expired, bundle.delivered));
      await this.store.releaseCustody(bundleId);
      this.store.dropInbox(bundleId);
      this.lastForwardAttempt.delete(bundleId);
      this.pushEvent('EXPIRE', `${bundleId} TTL exceeded — drop`);
      return null;
    }

    const next = this.cfg.nextHop[bundle.dst] ?? bundle.dst;
    const contactOpen = this.contacts.isOpenTo(next, now);

    if (custody.waitingAck) {
      if (!contactOpen) return null;
      if (!shouldRetry(this.lastForwardAttempt.get(bundleId) ?? null, now)) return null;
      this.lastForwardAttempt.set(bundleId, now);
      return { bundleId, next, bundle };
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

    const forwarding: RelayBundle = {
      ...bundle,
      state: 'FORWARDING',
      hops: [...bundle.hops, { from: this.cfg.nodeId, to: next, at: now }],
      events: [
        ...(bundle.events ?? []),
        { t: now, node: this.cfg.nodeId, kind: 'FORWARD', msg: 'FORWARDING' },
      ],
    };
    this.lastForwardAttempt.set(bundleId, now);
    custody.waitingAck = true;
    await this.store.putCustody(custody);
    await this.store.putBundle(forwarding);
    this.pushEvent('FORWARD', `${bundleId} → ${next} (contact open)`);
    return { bundleId, next, bundle: forwarding };
  }

  /** Peer HTTP. Must run while the bundle mutex is not held. */
  private async finishForward(job: ForwardJob): Promise<void> {
    const result = await this.peer.forwardTo(peerUrlFor(this.cfg, job.next), job.bundle);
    if (!result.ok) {
      await this.enqueue(() => this.applyForwardFailure(job.bundleId, result.error));
    }
  }

  /** Re-read after HTTP. Only WAITING + clear waitingAck while still FORWARDING with custody. */
  private async applyForwardFailure(bundleId: string, error: string | undefined): Promise<void> {
    const stored = await this.store.getBundle(bundleId);
    const custody = await this.store.getCustody(bundleId);
    if (!stored || !custody) return;
    if (stored.state !== 'FORWARDING') return;

    const reason = error ?? 'forward failed';
    const failed = noteForwardFailed(toTracked(stored), Date.now(), this.cfg.nodeId, reason);
    await this.store.putBundle(fromTracked(failed, stored.delivered));
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
    const acks = this.takeSendableAcks(Date.now());
    const ids = await this.store.listPendingBundleIds();
    const forwards: ForwardJob[] = [];
    for (const id of ids) {
      const job = await this.prepareForward(id);
      if (job) forwards.push(job);
    }
    return { acks, forwards };
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
    return {
      nodeId: this.cfg.nodeId,
      role: this.cfg.role,
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
    };
  }
}
