import type {
  AbsoluteContactWindow,
  AbsoluteSchedule,
  ContactSchedule,
  CyclicSchedule,
  DualContact,
  DualContactPlan,
} from '../bundle/bundle.types';

/** Timestamps below this are treated as offsets from plan-load baseMs (demo-friendly). */
export const ABSOLUTE_EPOCH_FLOOR_MS = 1_000_000_000_000; // ~2001-09-09

export type RawAbsoluteWindow =
  | AbsoluteContactWindow
  | { offsetStartMs: number; offsetEndMs: number };

export type RawAbsoluteSchedule = {
  type: 'absolute';
  windows: RawAbsoluteWindow[];
};

export type RawContactSchedule = CyclicSchedule | RawAbsoluteSchedule | {
  type?: 'cyclic';
  periodMs: number;
  openOffsetMs: number;
  openDurationMs: number;
};

function isOffsetWindow(w: RawAbsoluteWindow): w is { offsetStartMs: number; offsetEndMs: number } {
  return 'offsetStartMs' in w && 'offsetEndMs' in w;
}

/** Resolve one absolute window to wall-clock start/end. */
export function normalizeAbsoluteWindow(w: RawAbsoluteWindow, baseMs: number): AbsoluteContactWindow {
  if (isOffsetWindow(w)) {
    return { startMs: baseMs + w.offsetStartMs, endMs: baseMs + w.offsetEndMs };
  }
  if (w.startMs < ABSOLUTE_EPOCH_FLOOR_MS) {
    return { startMs: baseMs + w.startMs, endMs: baseMs + w.endMs };
  }
  return { startMs: w.startMs, endMs: w.endMs };
}

export function normalizeSchedule(
  schedule: RawContactSchedule,
  baseMs: number,
): ContactSchedule {
  if ((schedule as AbsoluteSchedule).type === 'absolute') {
    const raw = schedule as RawAbsoluteSchedule;
    const windows = raw.windows
      .map((w) => normalizeAbsoluteWindow(w, baseMs))
      .filter((w) => w.endMs > w.startMs)
      .sort((a, b) => a.startMs - b.startMs);
    return { type: 'absolute', windows };
  }
  const c = schedule as CyclicSchedule;
  return {
    type: 'cyclic',
    periodMs: c.periodMs,
    openOffsetMs: c.openOffsetMs,
    openDurationMs: c.openDurationMs,
  };
}

export function normalizeContactPlan(plan: DualContactPlan, baseMs = Date.now()): DualContactPlan {
  const contacts: DualContact[] = plan.contacts.map((c) => ({
    ...c,
    schedule: normalizeSchedule(c.schedule as RawContactSchedule, baseMs),
  }));
  return { ...plan, contacts };
}
