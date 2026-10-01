export type CyclicWindowSchedule = {
  type?: 'cyclic';
  periodMs: number;
  openOffsetMs: number;
  openDurationMs: number;
};

export type AbsoluteWindow = {
  startMs: number;
  endMs: number;
};

export type AbsoluteSchedule = {
  type: 'absolute';
  windows: AbsoluteWindow[];
};

export type ContactSchedule = CyclicWindowSchedule | AbsoluteSchedule;

export function isAbsoluteSchedule(schedule: ContactSchedule): schedule is AbsoluteSchedule {
  return (schedule as AbsoluteSchedule).type === 'absolute';
}

export function isCyclicOpen(now: number, schedule: CyclicWindowSchedule): boolean {
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  return elapsed >= schedule.openOffsetMs && elapsed < schedule.openOffsetMs + schedule.openDurationMs;
}

export function isContactOpen(now: number, schedule: ContactSchedule): boolean {
  if (isAbsoluteSchedule(schedule)) {
    return schedule.windows.some((w) => now >= w.startMs && now < w.endMs);
  }
  return isCyclicOpen(now, schedule);
}

/** Milliseconds until the next open window; 0 if already open. Infinity if never. */
export function msUntilOpen(now: number, schedule: ContactSchedule): number {
  if (isContactOpen(now, schedule)) return 0;
  if (isAbsoluteSchedule(schedule)) {
    let best = Number.POSITIVE_INFINITY;
    for (const w of schedule.windows) {
      if (w.startMs > now) best = Math.min(best, w.startMs - now);
    }
    return best;
  }
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  if (elapsed < schedule.openOffsetMs) {
    return schedule.openOffsetMs - elapsed;
  }
  return schedule.periodMs - elapsed + schedule.openOffsetMs;
}

/** Milliseconds until the current open window closes; 0 if closed. */
export function msUntilClose(now: number, schedule: ContactSchedule): number {
  if (!isContactOpen(now, schedule)) return 0;
  if (isAbsoluteSchedule(schedule)) {
    for (const w of schedule.windows) {
      if (now >= w.startMs && now < w.endMs) return w.endMs - now;
    }
    return 0;
  }
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  const closeAt = schedule.openOffsetMs + schedule.openDurationMs;
  return Math.max(0, closeAt - elapsed);
}

/** Compact human label for contact-arc countdowns (long delays included). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return 'never';
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
