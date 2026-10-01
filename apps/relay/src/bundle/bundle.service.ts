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

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Inject(LevelStore) private readonly store: LevelStore,
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(PeerService) private readonly peer: PeerService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
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
    await this.tryForward(bundle.id);
    return (await this.store.getBundle(bundle.id)) ?? bundle;
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
    const existing = await this.store.getBundle(bundle.id);
    if (existing) {
      void this.peer.sendAck(
        peerUrlFor(this.cfg, from),
        existing.id,
        existing.events ?? []
      );
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
      void this.peer.sendAck(peerUrlFor(this.cfg, from), stored.id, stored.events ?? []);
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
    void this.peer.sendAck(peerUrlFor(this.cfg, from), stored.id, stored.events ?? []);
    return {
      accepted: true,
      delivered: false,
      event: 'STORE',
      msg: `${stored.id} stored`,
    };
  }

  async onAck(bundleId: string, from: string, downstreamEvents: BundleEvent[] = []): Promise<void> {
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
    if (upstream) this.notifyUpstream(bundleId, upstream, acked.events, now);
  }

  private notifyUpstream(
    bundleId: string,
    upstream: string,
    events: BundleEvent[],
    now: number
  ): void {
    if (this.contacts.isOpenTo(upstream, now)) {
      void this.peer.sendAck(peerUrlFor(this.cfg, upstream), bundleId, events);
      return;
    }
    this.pendingAcks.push({ bundleId, upstream, events });
  }

  private async flushPendingAcks(now: number): Promise<void> {
    const queued = this.pendingAcks.splice(0, this.pendingAcks.length);
    const stillPending: PendingAck[] = [];
    for (const pending of queued) {
      if (!this.contacts.isOpenTo(pending.upstream, now)) {
        stillPending.push(pending);
        continue;
      }
      const sent = await this.peer.sendAck(
        peerUrlFor(this.cfg, pending.upstream),
        pending.bundleId,
        pending.events
      );
      if (!sent) stillPending.push(pending);
    }
    this.pendingAcks.push(...stillPending);
  }

  private async tryForward(bundleId: string): Promise<void> {
    const custody = await this.store.getCustody(bundleId);
    if (!custody) return;
    const bundle = await this.store.getBundle(bundleId);
    if (!bundle || bundle.delivered) return;
    if (bundle.state === 'ACKED' || bundle.state === 'EXPIRED' || bundle.state === 'ARRIVED') return;

    const now = Date.now();
    if (now - bundle.createdAt >= bundle.ttlMs) {
      const expired = markExpired(toTracked(bundle), now, this.cfg.nodeId);
      await this.store.putBundle(fromTracked(expired, bundle.delivered));
      await this.store.releaseCustody(bundleId);
      this.store.dropInbox(bundleId);
      this.lastForwardAttempt.delete(bundleId);
      this.pushEvent('EXPIRE', `${bundleId} TTL exceeded — drop`);
      return;
    }

    const next = this.cfg.nextHop[bundle.dst] ?? bundle.dst;
    const contactOpen = this.contacts.isOpenTo(next, now);

    if (custody.waitingAck) {
      if (!contactOpen) return;
      if (!shouldRetry(this.lastForwardAttempt.get(bundleId) ?? null, now)) return;
      this.lastForwardAttempt.set(bundleId, now);
      const result = await this.peer.forwardTo(peerUrlFor(this.cfg, next), bundle);
      if (!result.ok) await this.noteForwardAttemptFailed(bundle, result.error);
      return;
    }

    if (!shouldRetry(lastRetryAt(bundle.events), now)) return;

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
      return;
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

    const result = await this.peer.forwardTo(peerUrlFor(this.cfg, next), forwarding);
    if (!result.ok) await this.noteForwardAttemptFailed(forwarding, result.error);
  }

  private async noteForwardAttemptFailed(bundle: RelayBundle, error: string | undefined): Promise<void> {
    const stored = await this.store.getBundle(bundle.id);
    const custody = await this.store.getCustody(bundle.id);
    if (!stored || stored.state === 'ACKED' || !custody) return;

    const reason = error ?? 'forward failed';
    const failed = noteForwardFailed(toTracked(stored), Date.now(), this.cfg.nodeId, reason);
    await this.store.putBundle(fromTracked(failed, stored.delivered));
    const current = await this.store.getCustody(bundle.id);
    if (!current) return;
    current.waitingAck = false;
    await this.store.putCustody(current);
    this.pushEvent('RETRY', `${bundle.id} forward failed: ${reason}`);
  }

  private async tick(): Promise<void> {
    const open = this.contacts.isOpen();
    if (this.lastContactOpen === null || this.lastContactOpen !== open) {
      const st = this.contacts.getState();
      this.pushEvent(
        'CONTACT',
        `${this.cfg.nodeId}↔${st.peer} ${open ? 'OPEN' : 'CLOSE'} — ${st.phase}`
      );
      this.lastContactOpen = open;
    }
    await this.flushPendingAcks(Date.now());
    const ids = await this.store.listPendingBundleIds();
    for (const id of ids) {
      await this.tryForward(id);
    }
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
