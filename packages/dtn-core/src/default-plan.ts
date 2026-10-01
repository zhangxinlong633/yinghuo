import type { ContactPlanJson } from './dtn';

/** Earth–Relay–Mars plan matching the educational demo (virtual ms). */
export const defaultContactPlan: ContactPlanJson = {
  description: 'Earth ↔ Relay ↔ Mars educational contact plan (virtual ms)',
  scale:
    'Virtual ms → wall clock for k8s CronJob comments: 0–800 ≈ early window, 2000–3500 ≈ later window; see k8s/ ConfigMap.',
  nodes: [
    { name: 'Earth', role: 'endpoint', nextHop: { Mars: 'Relay', Relay: 'Relay' } },
    { name: 'Relay', role: 'relay', nextHop: { Mars: 'Mars', Earth: 'Earth' } },
    { name: 'Mars', role: 'endpoint', nextHop: { Earth: 'Relay', Relay: 'Relay' } },
  ],
  contacts: [
    {
      a: 'Earth',
      b: 'Relay',
      windows: [[0, 800]],
      delayMs: 200,
      bandwidthBps: 1_000_000,
    },
    {
      a: 'Relay',
      b: 'Mars',
      windows: [[2000, 3500]],
      delayMs: 400,
      bandwidthBps: 500_000,
    },
  ],
  application: {
    src: 'Earth',
    dst: 'Mars',
    payload: 'Hello Mars',
    ttlMs: 10000,
    atMs: 0,
  },
  maxTimeMs: 5000,
  tickMs: 100,
};
