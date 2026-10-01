/**
 * CLI demo entry (TypeScript) — Earth ↔ Relay ↔ Mars hardcoded scenario.
 */
import { Node, Simulator, createContact } from './dtn';

async function main(): Promise<void> {
  console.log('=== DTN Demo: Earth ↔ Relay ↔ Mars (roles) ===\n');
  const sim = new Simulator();
  const earth = new Node('Earth', { Mars: 'Relay', Relay: 'Relay' }, 'endpoint');
  const relay = new Node('Relay', { Mars: 'Mars', Earth: 'Earth' }, 'relay');
  const mars = new Node('Mars', { Earth: 'Relay', Relay: 'Relay' }, 'endpoint');
  sim.addNode(earth);
  sim.addNode(relay);
  sim.addNode(mars);
  sim.addContact(createContact('Earth', 'Relay', [[0, 800]], 200, 1_000_000));
  sim.addContact(createContact('Relay', 'Mars', [[2000, 3500]], 400, 500_000));
  sim.schedule(0, () => sim.send('Earth', 'Mars', 'Hello Mars', 10000));
  console.log('Roles: Earth=endpoint, Relay=relay, Mars=endpoint');
  console.log('Contacts: Earth↔Relay [0,800) delay=200; Relay↔Mars [2000,3500) delay=400\n');
  console.log('--- Timeline ---\n');
  await sim.run(5000, 100);
  const pending = earth.store.size + relay.store.size + mars.store.size;

  const hasDeliverMars = sim.events.some((e) => e.event === 'DELIVER' && e.node === 'Mars');
  const hasForwardRelay = sim.events.some((e) => e.event === 'FORWARD' && e.node === 'Relay');
  const createAtRelay = sim.events.some((e) => e.event === 'CREATE' && e.node === 'Relay');

  console.log('\n--- Result ---');
  console.log(
    `Assertions: DELIVER@Mars=${hasDeliverMars} FORWARD@Relay=${hasForwardRelay} no CREATE@Relay=${!createAtRelay}`
  );
  if (pending === 0 && hasDeliverMars && hasForwardRelay && !createAtRelay) {
    console.log('SUCCESS: bundle delivered; custody released; roles OK.');
    process.exit(0);
  }
  console.log(`FAIL: pending=${pending} deliverMars=${hasDeliverMars} forwardRelay=${hasForwardRelay} createRelay=${createAtRelay}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
