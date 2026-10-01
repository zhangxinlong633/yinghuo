export type CyclicWindowSchedule = {
  periodMs: number;
  openOffsetMs: number;
  openDurationMs: number;
};

export function isCyclicOpen(now: number, schedule: CyclicWindowSchedule): boolean {
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  return elapsed >= schedule.openOffsetMs && elapsed < schedule.openOffsetMs + schedule.openDurationMs;
}

/** Milliseconds until the next open window; 0 if already open. */
export function msUntilOpen(now: number, schedule: CyclicWindowSchedule): number {
  if (isCyclicOpen(now, schedule)) return 0;
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  if (elapsed < schedule.openOffsetMs) {
    return schedule.openOffsetMs - elapsed;
  }
  return schedule.periodMs - elapsed + schedule.openOffsetMs;
}
