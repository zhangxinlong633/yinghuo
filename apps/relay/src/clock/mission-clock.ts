export type ClockEnv = Record<string, string | undefined>;

function numEnv(env: ClockEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Mission elapsed ms. Default: wall clock. */
export function missionNow(wallMs = Date.now(), env: ClockEnv = process.env): number {
  const epoch = numEnv(env, 'MISSION_EPOCH_MS');
  if (epoch !== undefined) return wallMs - epoch;
  const offset = numEnv(env, 'MISSION_CLOCK_OFFSET_MS') ?? 0;
  return wallMs + offset;
}

export function describeMissionClock(
  wallMs = Date.now(),
  env: ClockEnv = process.env,
): { wallMs: number; missionMs: number; epochMs: number | null; offsetMs: number } {
  const epoch = numEnv(env, 'MISSION_EPOCH_MS') ?? null;
  const offset = numEnv(env, 'MISSION_CLOCK_OFFSET_MS') ?? 0;
  return { wallMs, missionMs: missionNow(wallMs, env), epochMs: epoch, offsetMs: offset };
}
