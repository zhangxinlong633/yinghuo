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
import { ContactService } from '../contact/contact.service';
import { LevelStore } from '../store/level-store';
import { PeerService } from '../peer/peer.service';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';

let seq = 0;

function newBundleId(nodeId: string): string {
  return `${nodeId}-B${Date.now()}-${++seq}`;
}

@Injectable()
export class BundleService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BundleService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: Array<{ t: number; event: string; msg: string }> = [];
  private lastContactOpen: boolean | null = null;

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
    const bundle: RelayBundle = {
      id: newBundleId(this.cfg.nodeId),
      src: this.cfg.nodeId,
      dst,
      payload,
      createdAt: Date.now(),
      ttlMs,
      hops: [],
      delivered: false,
    };
    await this.store.putBundle(bundle);
    await this.store.putCustody({
      bundleId: bundle.id,
      waitingAck: false,
      from: null,
      heldAt: Date.now(),
    });
    this.pushEvent('CREATE', `${bundle.id} ${bundle.src}→${bundle.dst} "${payload}"`);
    this.pushEvent('STORE', `${bundle.id} custody held (await contact)`);
    // Try immediate forward if window open
    await this.tryForward(bundle.id);
    return bundle;
  }

  /** Peer CLA ingest — called when contact is open and peer pushes a bundle. */
  async ingestFromPeer(bundle: RelayBundle, from: string): Promise<{
    accepted: boolean;
    delivered: boolean;
    event: string;
    msg: string;
  }> {
    // Destination match → local delivery
    if (bundle.dst === this.cfg.nodeId) {
      bundle.delivered = true;
      const msg: DeliveredMessage = {
        id: bundle.id,
        src: bundle.src,
        dst: bundle.dst,
        payload: bundle.payload,
        deliveredAt: Date.now(),
        hops: bundle.hops,
      };
      await this.store.deliverLocal(msg);
      this.pushEvent('DELIVER', `${bundle.id} payload="${bundle.payload}" from=${bundle.src}`);
      // ACK so peer releases custody
      void this.peer.sendAck(this.cfg.peerUrl, bundle.id);
      return {
        accepted: true,
        delivered: true,
        event: 'DELIVER',
        msg: `${bundle.id} delivered locally`,
      };
    }

    // Dual mode: endpoints normally don't relay for others
    if (this.cfg.role === 'endpoint') {
      this.pushEvent(
        'REJECT',
        `${bundle.id} role=endpoint refuses to relay (dst=${bundle.dst})`
      );
      return {
        accepted: false,
        delivered: false,
        event: 'REJECT',
        msg: 'endpoint will not store-and-forward for others',
      };
    }

    // relay / hybrid: store
    await this.store.putBundle(bundle);
    await this.store.putCustody({
      bundleId: bundle.id,
      waitingAck: false,
      from,
      heldAt: Date.now(),
    });
    this.pushEvent('STORE', `${bundle.id} from=${from} →${bundle.dst}`);
    void this.peer.sendAck(this.cfg.peerUrl, bundle.id);
    return {
      accepted: true,
      delivered: false,
      event: 'STORE',
      msg: `${bundle.id} stored`,
    };
  }

  async onAck(bundleId: string, from: string): Promise<void> {
    const custody = await this.store.getCustody(bundleId);
    if (!custody) return;
    this.pushEvent('ACK', `${bundleId} acked by ${from} — release custody`);
    await this.store.releaseCustody(bundleId);
    await this.store.deleteBundle(bundleId);
  }

  private async tryForward(bundleId: string): Promise<void> {
    const custody = await this.store.getCustody(bundleId);
    if (!custody || custody.waitingAck) return;
    const bundle = await this.store.getBundle(bundleId);
    if (!bundle || bundle.delivered) return;

    // TTL
    if (Date.now() - bundle.createdAt > bundle.ttlMs) {
      this.pushEvent('EXPIRE', `${bundleId} TTL exceeded — drop`);
      await this.store.releaseCustody(bundleId);
      await this.store.deleteBundle(bundleId);
      return;
    }

    const next = this.cfg.nextHop[bundle.dst] ?? bundle.dst;
    if (next !== this.contacts.getPeerName() && next !== bundle.dst) {
      this.pushEvent('NOROUTE', `${bundleId} no next-hop for ${bundle.dst}`);
      return;
    }

    if (!this.contacts.isOpen()) return;

    custody.waitingAck = true;
    await this.store.putCustody(custody);
    bundle.hops.push({ from: this.cfg.nodeId, to: next, at: Date.now() });
    await this.store.putBundle(bundle);

    const delay = this.contacts.delayMs();
    this.pushEvent(
      'FORWARD',
      `${bundleId} → ${next} (delay=${delay}ms, contact open)`
    );

    // Simulate propagation delay then push
    setTimeout(() => {
      void (async () => {
        const result = await this.peer.forwardToPeer(bundle);
        if (!result.ok) {
          const c = await this.store.getCustody(bundleId);
          if (c) {
            c.waitingAck = false;
            await this.store.putCustody(c);
          }
          this.pushEvent('RETRY', `${bundleId} forward failed: ${result.error}`);
          return;
        }
        // If peer delivered or accepted, wait for ACK; soft timeout to clear waitingAck
        setTimeout(() => {
          void (async () => {
            const c = await this.store.getCustody(bundleId);
            if (c && c.waitingAck) {
              c.waitingAck = false;
              await this.store.putCustody(c);
              this.pushEvent(
                'RETRY',
                `${bundleId} no ACK yet — will retry when contact open`
              );
            }
          })();
        }, delay + 2000);
      })();
    }, delay);
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
    if (!open) return;
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
