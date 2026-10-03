import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContactService } from '../contact/contact.service';
import type { RelayRuntimeConfig } from '../config';
import { RELAY_CONFIG } from '../relay.tokens';
import { PeerService } from '../peer/peer.service';
import { GraphService, GOSSIP_INTERVAL_MS, GOSSIP_THROTTLE_MS } from './graph.service';
import { localRegion, localTier } from './region-policy';

@Injectable()
export class GraphLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(GraphLifecycleService.name);
  private readonly lastGossipAt = new Map<string, number>();
  private gossipTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Inject(GraphService) private readonly graph: GraphService,
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(PeerService) private readonly peer: PeerService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.graphMode) return;
    if (this.cfg.bootstrapUrl) {
      void this.bootstrapJoin();
    }
    this.gossipTimer = setInterval(() => this.gossipTick(), GOSSIP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.gossipTimer) clearInterval(this.gossipTimer);
  }

  private async bootstrapJoin(): Promise<void> {
    const url = this.cfg.bootstrapUrl;
    if (!url) return;
    const result = await this.peer.postJoin(url, {
      nodeId: this.cfg.nodeId,
      eid: this.cfg.eid,
      port: this.cfg.port,
      x: this.cfg.x,
      y: this.cfg.y,
      peerUrl: this.cfg.peerUrl,
      role: this.cfg.role,
      region: localRegion() ?? undefined,
      tier: localTier(process.env, this.cfg.role),
    });
    if (result.ok !== true) {
      const err = 'error' in result ? result.error : 'unknown';
      this.log.warn(`bootstrap join failed: ${err}; continuing as solo island`);
    }
  }

  private gossipTick(): void {
    const now = Date.now();
    const summary = this.graph.exportSummary();
    for (const { id, url } of this.graph.snapshot(now).peers) {
      if (!this.contacts.isOpenTo(id, now)) continue;
      const last = this.lastGossipAt.get(id) ?? 0;
      if (now - last < GOSSIP_THROTTLE_MS) continue;
      this.lastGossipAt.set(id, now);
      void this.peer.postGraph(url, summary);
    }
  }
}
