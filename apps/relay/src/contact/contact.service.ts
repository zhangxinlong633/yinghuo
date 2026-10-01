import { Inject, Injectable } from '@nestjs/common';
import type { CyclicSchedule, DualContact } from '../bundle/bundle.types';
import { RELAY_CONFIG } from '../relay.tokens';
import type { RelayRuntimeConfig } from '../config';

export interface ContactState {
  peer: string;
  open: boolean;
  delayMs: number;
  schedule: CyclicSchedule;
  nextChangeAt: number;
  phase: string;
  contact: DualContact;
}

/**
 * Wall-clock cyclic contact windows for dual-relay demo.
 * Within each periodMs: open for [openOffsetMs, openOffsetMs+openDurationMs).
 */
@Injectable()
export class ContactService {
  private readonly contact: DualContact;
  private readonly peerName: string;

  constructor(@Inject(RELAY_CONFIG) private readonly cfg: RelayRuntimeConfig) {
    const c = cfg.plan.contacts.find(
      (x) =>
        (x.a === cfg.nodeId && x.b !== cfg.nodeId) ||
        (x.b === cfg.nodeId && x.a !== cfg.nodeId)
    );
    if (!c) {
      throw new Error(`No contact involving ${cfg.nodeId} in plan`);
    }
    this.contact = c;
    this.peerName = c.a === cfg.nodeId ? c.b : c.a;
  }

  getPeerName(): string {
    return this.peerName;
  }

  isOpen(now = Date.now()): boolean {
    const s = this.contact.schedule;
    if (s.type !== 'cyclic') return false;
    const elapsed = now % s.periodMs;
    return elapsed >= s.openOffsetMs && elapsed < s.openOffsetMs + s.openDurationMs;
  }

  delayMs(): number {
    return this.contact.delayMs;
  }

  getState(now = Date.now()): ContactState {
    const s = this.contact.schedule;
    const elapsed = now % s.periodMs;
    const open = this.isOpen(now);
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
    return {
      peer: this.peerName,
      open,
      delayMs: this.contact.delayMs,
      schedule: s,
      nextChangeAt,
      phase,
      contact: this.contact,
    };
  }
}
