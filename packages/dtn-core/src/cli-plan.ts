/**
 * Plan-driven CLI: load contact-plan JSON (default: k8s/contact-plan.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Simulator, ContactPlanJson, defaultContactPlan } from './index';

function resolvePlanPath(): string | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--plan');
  if (idx >= 0 && argv[idx + 1]) return path.resolve(argv[idx + 1]);
  const candidates = [
    path.resolve(__dirname, '../../../k8s/contact-plan.json'),
    path.resolve(process.cwd(), 'k8s/contact-plan.json'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function main(): Promise<void> {
  const planPath = resolvePlanPath();
  let plan: ContactPlanJson = defaultContactPlan;
  console.log('=== DTN Demo (contact-plan mode) ===\n');
  if (planPath) {
    console.log(`Loading: ${planPath}\n`);
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as ContactPlanJson;
  } else {
    console.log('No k8s/contact-plan.json found — using embedded defaultContactPlan\n');
  }
  const sim = new Simulator();
  sim.loadContactPlan(plan);
  const app = plan.application ?? defaultContactPlan.application!;
  sim.schedule(app.atMs ?? 0, () =>
    sim.send(app.src, app.dst, app.payload, app.ttlMs ?? 10000)
  );
  console.log('--- Timeline ---\n');
  await sim.run(plan.maxTimeMs ?? 5000, plan.tickMs ?? 100);
  let pending = 0;
  for (const n of sim.nodes.values()) pending += n.store.size;
  console.log('\n--- Result ---');
  if (pending === 0) {
    console.log('SUCCESS: plan-driven delivery complete.');
    process.exit(0);
  }
  console.log(`FAIL: ${pending} still in stores`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
