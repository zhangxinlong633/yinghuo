import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { BundleService } from '../bundle/bundle.service';
import type { RelayRuntimeConfig } from '../config';
import { ContactService } from '../contact/contact.service';
import { PeerService } from '../peer/peer.service';
import { RelayController } from '../relay/relay.controller';
import { edgeKey } from './graph-merge';
import { GraphService } from './graph.service';

function cfg(partial: Partial<RelayRuntimeConfig> = {}): RelayRuntimeConfig {
  return {
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1' },
    port: 3101,
    peerUrl: 'http://127.0.0.1:3101',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    startedAt: 0,
    graphMode: true,
    x: 0,
    y: 0,
    ...partial,
  };
}

function controller(graph: GraphService, contacts: ContactService, runtime: RelayRuntimeConfig): RelayController {
  return new RelayController({} as BundleService, contacts, runtime, graph);
}

test('graph mode boots with no plan contact and isOpenTo sees a joined peer', () => {
  const runtime = cfg();
  const graph = new GraphService(runtime);
  const contacts = new ContactService(runtime, graph);
  assert.equal(contacts.isOpenTo('Probe'), false);

  graph.applyJoin({
    nodeId: 'Probe',
    eid: 'ipn:8.1',
    port: 3200,
    x: 2,
    y: 3,
    peerUrl: 'http://127.0.0.1:3200',
  });

  assert.equal(contacts.isOpenTo('Probe', 15_000), true);
  assert.equal(contacts.delayTo('Probe'), 0);
  const link = contacts.listLinks(15_000).find((l) => l.peer === 'Probe');
  assert.equal(link?.local, true);
  assert.equal(link?.schedule.periodMs, 30_000);
  assert.equal(link?.schedule.openDurationMs, 30_000);
});

test('static plan still requires a local contact', () => {
  assert.throws(
    () => new ContactService(cfg({ graphMode: false })),
    /No contact involving Earth/,
  );
});

test('join and graph handlers record peers and ingest summaries', () => {
  const runtime = cfg();
  const graph = new GraphService(runtime);
  const contacts = new ContactService(runtime, graph);
  const api = controller(graph, contacts, runtime);

  const joined = api.peerJoin({
    nodeId: 'Probe',
    eid: 'ipn:8.1',
    port: 3200,
    x: 4,
    y: 1,
    peerUrl: 'http://127.0.0.1:3200',
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.localEid, 'ipn:1.1');
  assert.equal(joined.summary.from, 'Earth');
  assert.equal(contacts.isOpenTo('Probe'), true);
  assert.equal(runtime.eidByNode.Probe, 'ipn:8.1');

  const snap = api.graphSnapshot();
  assert.equal(snap.stats.peerCount, 1);

  api.peerGraph({
    from: 'Probe',
    nodes: [{ id: 'Far', eid: 'ipn:9.1', x: 20, y: 0 }],
    edges: [
      {
        a: 'Probe',
        b: 'Far',
        delayMs: 50,
        schedule: { type: 'cyclic', periodMs: 30_000, openOffsetMs: 0, openDurationMs: 30_000 },
        originatedAt: 10,
        hopCount: 0,
      },
    ],
  });
  const heard = graph.exportSummary().edges.find((e) => edgeKey(e.a, e.b) === edgeKey('Probe', 'Far'));
  assert.equal(heard?.hopCount, 1);
  assert.equal(api.graphSnapshot().nodes.some((n) => n.id === 'Far'), true);
  const route = api.graphRoute('Far');
  assert.equal(route.nextHop, 'Probe');
  assert.ok(Array.isArray(route.candidates));
  assert.ok(Array.isArray(route.culled));
  assert.throws(
    () => api.graphRoute(''),
    (err: unknown) => err instanceof BadRequestException,
  );

  assert.throws(
    () => api.peerJoin({ nodeId: 'X' } as never),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      const body = err.getResponse() as { error?: string };
      assert.match(body.error ?? '', /nodeId, eid, port/);
      return true;
    },
  );
});

test('postJoin and postGraph update both sides over HTTP', async () => {
  const serverCfg = cfg({ nodeId: 'Earth', eid: 'ipn:1.1', x: 0, y: 0, port: 3101 });
  const serverGraph = new GraphService(serverCfg);
  const serverContacts = new ContactService(serverCfg, serverGraph);
  const api = controller(serverGraph, serverContacts, serverCfg);

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as never;
    try {
      const out =
        req.url === '/api/peer/join'
          ? api.peerJoin(body)
          : req.url === '/api/peer/graph'
            ? api.peerGraph(body)
            : { ok: false };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const clientCfg = cfg({
      nodeId: 'Probe',
      eid: 'ipn:8.1',
      eidByNode: { Probe: 'ipn:8.1' },
      port: 3200,
      peerUrl: 'http://127.0.0.1:3200',
      x: 4,
      y: 1,
    });
    const clientGraph = new GraphService(clientCfg);
    const clientContacts = new ContactService(clientCfg, clientGraph);
    const peer = new PeerService(clientCfg, clientGraph);

    const joined = await peer.postJoin(base, {
      nodeId: 'Probe',
      eid: 'ipn:8.1',
      port: 3200,
      x: 4,
      y: 1,
      peerUrl: clientCfg.peerUrl,
    });
    assert.equal(joined.ok, true);
    assert.equal(serverContacts.isOpenTo('Probe'), true);
    assert.equal(clientContacts.isOpenTo('Earth'), true);
    assert.equal(clientGraph.peerUrl('Earth'), base);

    clientGraph.ingestSummary({
      from: 'Probe',
      nodes: [{ id: 'Far', eid: 'ipn:9.1', x: 12, y: 0 }],
      edges: [
        {
          a: 'Probe',
          b: 'Far',
          delayMs: 40,
          schedule: { type: 'cyclic', periodMs: 30_000, openOffsetMs: 0, openDurationMs: 30_000 },
          originatedAt: 5,
          hopCount: 0,
        },
      ],
    });
    assert.equal(await peer.postGraph(base, clientGraph.exportSummary()), true);
    assert.equal(serverGraph.listKnownNodeIds().includes('Far'), true);
    const decision = api.graphRoute('Far');
    assert.equal(decision.nextHop, 'Probe');
    assert.ok(Array.isArray(decision.candidates));
    assert.ok(Array.isArray(decision.culled));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
