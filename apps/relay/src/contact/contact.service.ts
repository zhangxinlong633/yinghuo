import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ContactSchedule, DualContact } from '../bundle/bundle.types';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';
import { GraphService } from '../graph/graph.service';
import {
  formatDurationMs,
  isContactOpen,
  msUntilClose,
  msUntilOpen,
} from './contact-window';

export interface ContactState {
  peer: string;
  open: boolean;
  delayMs: number;
  /** Human label for propagation delay (e.g. 30s, 1m 5s). */
  delayLabel: string;
  schedule: ContactSchedule;
  nextChangeAt: number;
  /** ms until next open/close boundary. */
  remainMs: number;
  remainLabel: string;
  phase: string;
  contact: DualContact;
}

export interface ContactSnapshot extends ContactState {
  links: ContactLinkState[];
  localEid: string;
  eidByNode: Record<string, string>;
  wireFormat: 'application/cbor';
}

export interface ContactLinkState {
  a: string;
  b: string;
  peer: string;
  local: boolean;
  open: boolean;
  delayMs: number;
  delayLabel: string;
  schedule: ContactSchedule;
  nextChangeAt: number;
  remainMs: number;
  remainLabel: string;
  phase: string;
  bandwidthBps?: number;
}

/**
 * Contact windows: cyclic (period modulo) or absolute (epoch / load-normalized).
 */
@Injectable()
export class ContactService {
  private planContacts: DualContact[];
  /** Static plan contact for this node. Absent in graph mode until a peer joins. */
  private anchored?: DualContact;

  constructor(
    @Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig,
    @Optional() @Inject(GraphService) private readonly graph?: GraphService,
  ) {
    this.planContacts = cfg.plan.contacts;
    this.reanchor();
  }

  /**
   * Hot-reload plan contacts (same process). Recomputes the anchored local row.
   * Throws if non-graph mode and no contact involves this node.
   */
  replacePlanContacts(contacts: DualContact[]): void {
    this.planContacts = contacts;
    this.reanchor();
  }

  private reanchor(): void {
    const local = this.planContacts.find((x) => x.a === this.cfg.nodeId || x.b === this.cfg.nodeId);
    if (!local && !this.cfg.graphMode) {
      throw new Error(`No contact involving ${this.cfg.nodeId}`);
    }
    this.anchored = local;
  }

  getPeerName(): string {
    return this.peerOf(this.primaryContact());
  }

  isOpen(now = Date.now()): boolean {
    return isContactOpen(now, this.primaryContact().schedule);
  }

  delayMs(): number {
    return this.primaryContact().delayMs;
  }

  listLinks(now = Date.now()): ContactLinkState[] {
    return this.mergedContacts().map((c) => {
      const timing = this.windowTiming(c.schedule, now);
      const link: ContactLinkState = {
        a: c.a,
        b: c.b,
        peer: this.peerOf(c),
        local: c.a === this.cfg.nodeId || c.b === this.cfg.nodeId,
        open: timing.open,
        delayMs: c.delayMs,
        delayLabel: formatDurationMs(c.delayMs),
        schedule: c.schedule,
        nextChangeAt: timing.nextChangeAt,
        remainMs: timing.remainMs,
        remainLabel: timing.remainLabel,
        phase: timing.phase,
      };
      if (c.bandwidthBps !== undefined) link.bandwidthBps = c.bandwidthBps;
      return link;
    });
  }

  isOpenTo(nextHopName: string, now = Date.now()): boolean {
    const link = this.listLinks(now).find((l) => l.local && l.peer === nextHopName);
    return link ? link.open : false;
  }

  delayTo(nextHopName: string): number {
    const link = this.mergedContacts().find(
      (c) =>
        (c.a === this.cfg.nodeId || c.b === this.cfg.nodeId) && this.peerOf(c) === nextHopName
    );
    return link ? link.delayMs : 0;
  }

  getState(now = Date.now()): ContactState {
    const contact = this.primaryContact();
    const timing = this.windowTiming(contact.schedule, now);
    return {
      peer: this.peerOf(contact),
      open: timing.open,
      delayMs: contact.delayMs,
      delayLabel: formatDurationMs(contact.delayMs),
      schedule: contact.schedule,
      nextChangeAt: timing.nextChangeAt,
      remainMs: timing.remainMs,
      remainLabel: timing.remainLabel,
      phase: timing.phase,
      contact,
    };
  }

  /** Network view for GET /api/contacts: windows plus local/peer EIDs and CBOR. */
  snapshot(now = Date.now()): ContactSnapshot {
    return {
      ...this.getState(now),
      links: this.listLinks(now),
      localEid: this.cfg.eid,
      eidByNode: this.cfg.eidByNode,
      wireFormat: 'application/cbor',
    };
  }

  /**
   * Plan contacts plus direct edges upserted by join.
   * A plan row for the same peer wins so static windows stay unchanged.
   */
  private mergedContacts(): DualContact[] {
    const dynamic = this.graph?.directContacts() ?? [];
    if (dynamic.length === 0) return this.planContacts;
    const plannedPeers = new Set(
      this.planContacts
        .filter((c) => c.a === this.cfg.nodeId || c.b === this.cfg.nodeId)
        .map((c) => this.peerOf(c)),
    );
    const extras = dynamic.filter((c) => {
      const peer = this.peerOf(c);
      return peer.length > 0 && !plannedPeers.has(peer);
    });
    return extras.length === 0 ? this.planContacts : [...this.planContacts, ...extras];
  }

  private primaryContact(): DualContact {
    if (this.anchored) return this.anchored;
    const dynamic = this.mergedContacts().find(
      (c) => c.a === this.cfg.nodeId || c.b === this.cfg.nodeId,
    );
    if (dynamic) return dynamic;
    return {
      a: this.cfg.nodeId,
      b: '',
      delayMs: 0,
      schedule: {
        type: 'cyclic',
        periodMs: 30_000,
        openOffsetMs: 0,
        openDurationMs: 0,
      },
    };
  }

  private peerOf(c: DualContact): string {
    if (c.a === this.cfg.nodeId) return c.b;
    if (c.b === this.cfg.nodeId) return c.a;
    return '';
  }

  private windowTiming(
    schedule: ContactSchedule,
    now: number
  ): { open: boolean; nextChangeAt: number; remainMs: number; remainLabel: string; phase: string } {
    const open = isContactOpen(now, schedule);
    const remainMs = open ? msUntilClose(now, schedule) : msUntilOpen(now, schedule);
    const remainLabel = formatDurationMs(remainMs);
    const nextChangeAt = Number.isFinite(remainMs) ? now + remainMs : Number.POSITIVE_INFINITY;
    const phase = open
      ? `OPEN — closes in ${remainLabel}`
      : remainMs === Number.POSITIVE_INFINITY
        ? 'CLOSED — no further windows'
        : `CLOSED — opens in ${remainLabel}`;
    return { open, nextChangeAt, remainMs, remainLabel, phase };
  }
}
