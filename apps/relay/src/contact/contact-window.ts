export function isCyclicOpen(
  now: number,
  schedule: { periodMs: number; openOffsetMs: number; openDurationMs: number }
): boolean {
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  return elapsed >= schedule.openOffsetMs && elapsed < schedule.openOffsetMs + schedule.openDurationMs;
}
