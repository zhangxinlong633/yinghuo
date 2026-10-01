import { Inject, Injectable } from '@nestjs/common';
import type { CyclicSchedule, DualContact } from '../bundle/bundle.types';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';
import { isCyclicOpen } from './contact-window';

export interface ContactState {
  peer: string;
  open: boolean;
  delayMs: number;
  schedule: CyclicSchedule;
  nextChangeAt: number;
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
  schedule: CyclicSchedule;
  nextChangeAt: number;
  phase: string;
  bandwidthBps?: number;
}

/**
 * Wall-clock cyclic contact windows.
 * Within each periodMs: open for [openOffsetMs, openOffsetMs+openDurationMs).
 */
@Injectable()
export class ContactService {
  private readonly contacts: DualContact[];
  private readonly localContact: DualContact;
  private readonly peerName: string;

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {
    this.contacts = cfg.plan.contacts;
    const local = this.contacts.find((x) => x.a === cfg.nodeId || x.b === cfg.nodeId);
    if (!local) {
      throw new Error(`No contact involving ${cfg.nodeId}`);
    }
    this.localContact = local;
    this.peerName = this.peerOf(local);
  }

  getPeerName(): string {
    return this.peerName;
  }

  isOpen(now = Date.now()): boolean {
    return isCyclicOpen(now, this.localContact.schedule);
  }

  delayMs(): number {
    return this.localContact.delayMs;
  }

  listLinks(now = Date.now()): ContactLinkState[] {
    return this.contacts.map((c) => {
      const timing = this.windowTiming(c.schedule, now);
      const link: ContactLinkState = {
        a: c.a,
        b: c.b,
        peer: this.peerOf(c),
        local: c.a === this.cfg.nodeId || c.b === this.cfg.nodeId,
        open: timing.open,
        delayMs: c.delayMs,
        schedule: c.schedule,
        nextChangeAt: timing.nextChangeAt,
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
    const link = this.contacts.find(
      (c) =>
        (c.a === this.cfg.nodeId || c.b === this.cfg.nodeId) && this.peerOf(c) === nextHopName
    );
    return link ? link.delayMs : 0;
  }

  getState(now = Date.now()): ContactState {
    const timing = this.windowTiming(this.localContact.schedule, now);
    return {
      peer: this.peerName,
      open: timing.open,
      delayMs: this.localContact.delayMs,
      schedule: this.localContact.schedule,
      nextChangeAt: timing.nextChangeAt,
      phase: timing.phase,
      contact: this.localContact,
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

  private peerOf(c: DualContact): string {
    if (c.a === this.cfg.nodeId) return c.b;
    if (c.b === this.cfg.nodeId) return c.a;
    return '';
  }

  private windowTiming(
    schedule: CyclicSchedule,
    now: number
  ): { open: boolean; nextChangeAt: number; phase: string } {
    const s = schedule;
    const elapsed = ((now % s.periodMs) + s.periodMs) % s.periodMs;
    const open = isCyclicOpen(now, s);
    let nextChangeAt: number;
    let phase: string;
    if (open) {
      const closeAt = s.openOffsetMs + s.openDurationMs;
      nextChangeAt = now + (closeAt - elapsed);
      phase = `OPEN until +${closeAt - elapsed}ms in period`;
    } else if (elapsed < s.openOffsetMs) {
      nextChangeAt = now + (s.openOffsetMs - elapsed);
      phase = `CLOSED — opens in ${s.openOffsetMs - elapsed}ms`;
    } else {
      nextChangeAt = now + (s.periodMs - elapsed + s.openOffsetMs);
      phase = `CLOSED — opens in ${s.periodMs - elapsed + s.openOffsetMs}ms`;
    }
    return { open, nextChangeAt, phase };
  }
}
