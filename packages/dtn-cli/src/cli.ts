#!/usr/bin/env tsx
/**
 * dtn CLI — talks only to local relay HTTP API.
 *
 * Usage:
 *   npm run cli -- status
 *   npm run cli -- send Mars "Hello Mars"
 *   npm run cli -- recv
 *   npm run cli -- wait
 *
 * Env:
 *   DTN_RELAY_URL  default http://127.0.0.1:3101
 *   DTN_NODE       Earth|Relay|Mars  (sets default URL if DTN_RELAY_URL unset)
 */
import { DtnClient } from '@lightlink/sdk';

function resolveUrl(): string {
  if (process.env.DTN_RELAY_URL) return process.env.DTN_RELAY_URL;
  const node = (process.env.DTN_NODE ?? 'Earth').toLowerCase();
  if (node === 'mars') return 'http://127.0.0.1:3102';
  if (node === 'relay') return 'http://127.0.0.1:3103';
  return 'http://127.0.0.1:3101';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'help';
  const client = new DtnClient({ baseUrl: resolveUrl() });

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    console.log(`dtn CLI (local relay only)

  status                 Show relay + contact + store depths
  send <dst> <payload>   Inject bundle at local relay
  recv                   Poll+clear delivered inbox
  inbox                  Peek inbox without clear
  wait [timeoutSec]      Subscribe until delivery (default 60s)

Env: DTN_RELAY_URL / DTN_NODE=Earth|Relay|Mars
Current relay: ${resolveUrl()}
`);
    return;
  }

  if (cmd === 'status') {
    const s = await client.status();
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  if (cmd === 'send') {
    const dst = args[1];
    const payload = args.slice(2).join(' ') || 'Hello';
    if (!dst) {
      console.error('usage: send <dst> <payload>');
      process.exit(2);
    }
    const r = await client.send(dst, payload);
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exit(1);
    return;
  }

  if (cmd === 'recv') {
    const msgs = await client.recv(true);
    console.log(JSON.stringify({ messages: msgs }, null, 2));
    return;
  }

  if (cmd === 'inbox') {
    const msgs = await client.inbox();
    console.log(JSON.stringify({ messages: msgs }, null, 2));
    return;
  }

  if (cmd === 'wait') {
    const timeoutSec = Number(args[1] ?? 60);
    console.error(`waiting up to ${timeoutSec}s on ${resolveUrl()} …`);
    const msgs = await client.subscribeDelivery({
      timeoutMs: timeoutSec * 1000,
      intervalMs: 500,
      onTick: (s) => {
        process.stderr.write(
          `\r[${s.nodeId}] contact=${s.contact.open ? 'OPEN ' : 'CLOSE'} inbox=${s.store.inbox} custody=${s.store.custody}   `
        );
      },
    });
    process.stderr.write('\n');
    console.log(JSON.stringify({ messages: msgs }, null, 2));
    if (msgs.length === 0) process.exit(1);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
