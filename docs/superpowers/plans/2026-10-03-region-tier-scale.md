# 区域与档位水平扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DTN_REGION` 开启后，图与 CGR 停在区内骨干，跨区只走区门，小设备 `edge` 不跑全图；未设置时行为与现在完全一致。

**Architecture:** `region-policy.ts` 只解析开关／档位／join 是否允许。`graph-merge` 丢外区。`GraphService` 管 join 403、edge 摘要裁剪、`gateways[]`。`decideNextHop` 在 dst 不在图时改走区门，`edge` 只选直连 backbone。`BundleService` 带 `dstRegion`，分区下副本只打同区骨干。

**Tech Stack:** 现有 Nest relay、`node:test` + `tsx`、环境变量；不加新依赖。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-03-region-tier-scale-design.md`
- `DTN_REGION` 为空：join／gossip／CGR／副本与落地前一致；现有 `@yinghuo/relay` 单测必须全绿
- `DTN_REGION` 非空才启用分区；缺 `region`／`tier` 的对端视为同区、按 ROLE 推断档位
- 不实现层级 EID、跨任务 PKI、ION coped；不测几亿进程
- 不改 SHA-256／CORRUPT／PROMOTE／AUDIT／关窗不提升
- `GRAPH_MAX_HOP` 仍为 3，只约束区内听说边
- 未获用户明确要求时不要 `git commit`／`git push`

## File map

| Path | Responsibility |
|------|----------------|
| `apps/relay/src/graph/region-policy.ts` | `regionEnabled`／`localRegion`／`parseTier`／`parseRegionPeers`／`joinAllowed` |
| `apps/relay/src/graph/region-policy.test.ts` | 空 region、推断、peers、join 分支 |
| `apps/relay/src/graph/graph.types.ts` | 节点 `region`／`tier`；`RegionGateway`；summary `gateways` |
| `apps/relay/src/graph/graph-merge.ts` | `localRegion` 时丢外区节点／边 |
| `apps/relay/src/graph/graph.service.ts` | join 判定、export 裁剪、记录 gateways |
| `apps/relay/src/relay/relay.controller.ts` | 403 `REGION_MISMATCH`；send／ingest `dstRegion` |
| `apps/relay/src/graph/graph-route.ts` | edge 上行；未知 dst + `dstRegion` → 区门 |
| `apps/relay/src/bundle/bundle.types.ts` | `dstRegion`；status `region`／`tier` |
| `apps/relay/src/bundle/replica-select.ts` | 分区 + edge 且未设 `DTN_REPLICA_N` → 0 |
| `apps/relay/src/bundle/bundle.service.ts` | 写 `dstRegion`；副本过滤骨干 |
| `README.md` `docs/interop.md` `docs/fault-tolerance.md` | 配置说明 |

---

### Task 1: region-policy

**Files:**
- Create: `apps/relay/src/graph/region-policy.ts`
- Create: `apps/relay/src/graph/region-policy.test.ts`

**Interfaces:**
- Consumes: `resolveMissionRole` from `../role/role-policy`
- Produces:
  - `export type NodeTier = 'backbone' | 'edge'`
  - `regionEnabled(env?: Record<string, string | undefined>): boolean`
  - `localRegion(env?: Record<string, string | undefined>): string | null`
  - `parseTier(raw: string | undefined, role?: string): NodeTier`
  - `localTier(env?: Record<string, string | undefined>, role?: string): NodeTier`
  - `parseRegionPeers(raw?: string): Record<string, string>`
  - `joinAllowed(opts: { partitioning: boolean; localRegion: string; remoteRegion?: string; localTier: NodeTier; remoteTier: NodeTier; regionPeerKeys: string[] }): { ok: true } | { ok: false; error: 'REGION_MISMATCH' }`

- [ ] **Step 1: Write the failing test**

Create `apps/relay/src/graph/region-policy.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  joinAllowed,
  localRegion,
  localTier,
  parseRegionPeers,
  parseTier,
  regionEnabled,
} from './region-policy';

test('empty DTN_REGION disables partitioning', () => {
  assert.equal(regionEnabled({}), false);
  assert.equal(regionEnabled({ DTN_REGION: '' }), false);
  assert.equal(localRegion({ DTN_REGION: 'earth' }), 'earth');
});

test('parseTier env then role: orbiter/cruise backbone else edge', () => {
  assert.equal(parseTier('backbone'), 'backbone');
  assert.equal(parseTier('edge'), 'edge');
  assert.equal(parseTier(undefined, 'orbiter'), 'backbone');
  assert.equal(parseTier(undefined, 'cruise'), 'backbone');
  assert.equal(parseTier(undefined, 'lander'), 'edge');
  assert.equal(parseTier(undefined, 'ground'), 'edge');
  assert.equal(localTier({ DTN_TIER: 'edge' }, 'orbiter'), 'edge');
});

test('parseRegionPeers splits region=url', () => {
  const m = parseRegionPeers('mars=http://127.0.0.1:3202, moon=http://127.0.0.1:3203');
  assert.equal(m.mars, 'http://127.0.0.1:3202');
  assert.equal(m.moon, 'http://127.0.0.1:3203');
});

test('joinAllowed: off or same region ok; foreign edge mismatch; backbone gateway ok', () => {
  assert.equal(joinAllowed({
    partitioning: false, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: undefined,
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'earth',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: [],
  }).ok, true);
  const no = joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'edge', regionPeerKeys: ['mars'],
  });
  assert.equal(no.ok, false);
  if (!no.ok) assert.equal(no.error, 'REGION_MISMATCH');
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'backbone', regionPeerKeys: ['mars'],
  }).ok, true);
  assert.equal(joinAllowed({
    partitioning: true, localRegion: 'earth', remoteRegion: 'mars',
    localTier: 'backbone', remoteTier: 'backbone', regionPeerKeys: [],
  }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/graph/region-policy.test.ts`

Expected: FAIL (`Cannot find module './region-policy'`).

- [ ] **Step 3: Write minimal implementation**

Create `apps/relay/src/graph/region-policy.ts`:

```typescript
import { resolveMissionRole } from '../role/role-policy';

export type NodeTier = 'backbone' | 'edge';

export function regionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.DTN_REGION ?? '').trim() !== '';
}

export function localRegion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const r = (env.DTN_REGION ?? '').trim();
  return r === '' ? null : r;
}

export function parseTier(raw: string | undefined, role?: string): NodeTier {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'backbone' || t === '骨干') return 'backbone';
  if (t === 'edge' || t === 'leaf' || t === '叶子') return 'edge';
  const mission = resolveMissionRole(role ?? 'lander');
  if (mission === 'orbiter' || mission === 'cruise') return 'backbone';
  return 'edge';
}

export function localTier(
  env: Record<string, string | undefined> = process.env,
  role?: string,
): NodeTier {
  return parseTier(env.DTN_TIER, role ?? env.ROLE);
}

export function parseRegionPeers(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function joinAllowed(opts: {
  partitioning: boolean;
  localRegion: string;
  remoteRegion?: string;
  localTier: NodeTier;
  remoteTier: NodeTier;
  regionPeerKeys: string[];
}): { ok: true } | { ok: false; error: 'REGION_MISMATCH' } {
  if (!opts.partitioning) return { ok: true };
  const remote = (opts.remoteRegion ?? '').trim();
  if (!remote || remote === opts.localRegion) return { ok: true };
  const gateway =
    opts.localTier === 'backbone' &&
    opts.remoteTier === 'backbone' &&
    opts.regionPeerKeys.includes(remote);
  if (gateway) return { ok: true };
  return { ok: false, error: 'REGION_MISMATCH' };
}
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npm test -w @yinghuo/relay -- src/graph/region-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 2: mergeSummary 丢外区

**Files:**
- Modify: `apps/relay/src/graph/graph.types.ts`
- Modify: `apps/relay/src/graph/graph-merge.ts`
- Modify: `apps/relay/src/graph/graph-merge.test.ts`

**Interfaces:**
- Consumes: `NodeTier` from `region-policy`
- Produces: `GraphNode.region?`／`GraphNode.tier?`；`RegionGateway`；`GraphSummary.gateways?`；`mergeSummary(..., { maxHop, now, localRegion?: string | null })`

- [ ] **Step 1: Write the failing test**

Append to `apps/relay/src/graph/graph-merge.test.ts`:

```typescript
test('drops nodes and edges outside localRegion when set', () => {
  const local = emptyGraph();
  local.nodes.set('Earth', { id: 'Earth', eid: 'ipn:1.1', x: 0, y: 0, region: 'earth' });
  const merged = mergeSummary(
    local,
    {
      from: 'Relay',
      nodes: [
        { id: 'Near', eid: 'ipn:2.1', x: 1, y: 0, region: 'earth' },
        { id: 'Phobos', eid: 'ipn:9.1', x: 9, y: 0, region: 'mars' },
      ],
      edges: [
        { a: 'Relay', b: 'Near', delayMs: 1, schedule: sched, originatedAt: 1, hopCount: 0 },
        { a: 'Relay', b: 'Phobos', delayMs: 1, schedule: sched, originatedAt: 1, hopCount: 0 },
      ],
    },
    { maxHop: 3, now: 100, localRegion: 'earth' },
  );
  assert.equal(merged.nodes.has('Near'), true);
  assert.equal(merged.nodes.has('Phobos'), false);
  assert.equal(merged.edges.has(edgeKey('Relay', 'Near')), true);
  assert.equal(merged.edges.has(edgeKey('Relay', 'Phobos')), false);
});

test('keeps foreign nodes when localRegion unset', () => {
  const merged = mergeSummary(
    emptyGraph(),
    {
      from: 'A',
      nodes: [{ id: 'Phobos', eid: 'ipn:9.1', x: 9, y: 0, region: 'mars' }],
      edges: [],
    },
    { maxHop: 3, now: 100 },
  );
  assert.equal(merged.nodes.has('Phobos'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/graph/graph-merge.test.ts`

Expected: FAIL (unknown option `localRegion` or nodes not dropped).

- [ ] **Step 3: Write minimal implementation**

In `graph.types.ts` add `region?: string; tier?: NodeTier` on `GraphNode` (import `NodeTier`). Add:

```typescript
export type RegionGateway = { region: string; nodeId: string; eid: string };
```

Change `GraphSummary` to:

```typescript
export type GraphSummary = {
  from: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  gateways?: RegionGateway[];
};
```

In `graph-merge.ts`, extend opts with `localRegion?: string | null`. After building candidate maps, if `opts.localRegion` is a non-empty string:

1. Delete any node whose `region` is non-empty and `!== opts.localRegion`.
2. Delete any edge whose `a` or `b` is missing from remaining nodes **or** whose endpoint region (from remaining+incoming node maps) is non-empty and `!== opts.localRegion`.
3. Nodes with missing `region` stay (视为同区).

Do not filter when `localRegion` is null/undefined.

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay -- src/graph/graph-merge.test.ts`

Expected: PASS, including existing hopCount test.

- [ ] **Step 5: Commit only if the user asked**

---

### Task 3: Join 403、export 裁剪、gateways

**Files:**
- Modify: `apps/relay/src/graph/graph.service.ts` (`JoinRemote`、`applyJoin`、`exportSummary`、`ingestSummary`、`decide` 入参预留 gateways)
- Modify: `apps/relay/src/relay/relay.controller.ts` (`peerJoin`)
- Modify: `apps/relay/src/graph/graph.service.test.ts`
- Test: `apps/relay/src/relay/graph-http.test.ts`（若 join 走 HTTP；否则只测 GraphService + 单测 Forbidden 逻辑）

**Interfaces:**
- Consumes: `joinAllowed`、`localRegion`、`localTier`、`parseTier`、`parseRegionPeers`、`regionEnabled`
- Produces:
  - `JoinRemote.region?: string`；`JoinRemote.tier?: string`
  - `GraphService.evaluateJoin(remote: JoinRemote): ReturnType<typeof joinAllowed>`
  - `GraphService.listGateways(): RegionGateway[]`
  - `exportSummary()`：分区 + edge 时 nodes/edges 仅 self+direct；backbone 带 `gateways`

- [ ] **Step 1: Write the failing test**

Append to `graph.service.test.ts`（用 `cfg({ role: 'orbiter' })`，测试前后保存／恢复 `DTN_REGION`／`DTN_TIER`／`DTN_REGION_PEERS`）：

```typescript
test('evaluateJoin rejects foreign edge when DTN_REGION set', () => {
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  const graph = new GraphService(cfg({ role: 'orbiter' }));
  const no = graph.evaluateJoin({
    nodeId: 'Phobos', eid: 'ipn:9.1', port: 9, x: 9, y: 0,
    peerUrl: 'http://127.0.0.1:9', role: 'lander', region: 'mars',
  });
  assert.equal(no.ok, false);
});

test('evaluateJoin allows foreign backbone listed in DTN_REGION_PEERS', () => {
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'backbone';
  process.env.DTN_REGION_PEERS = 'mars=http://127.0.0.1:3202';
  const graph = new GraphService(cfg({ role: 'orbiter' }));
  const ok = graph.evaluateJoin({
    nodeId: 'MarsGw', eid: 'ipn:3.1', port: 3202, x: 3, y: 0,
    peerUrl: 'http://127.0.0.1:3202', role: 'orbiter', region: 'mars', tier: 'backbone',
  });
  assert.equal(ok.ok, true);
});

test('edge exportSummary omits heard edges', () => {
  process.env.DTN_REGION = 'earth';
  process.env.DTN_TIER = 'edge';
  const graph = new GraphService(cfg({ nodeId: 'Handset', role: 'lander' }));
  graph.applyJoin({
    nodeId: 'Relay', eid: 'ipn:2.1', port: 2, x: 1, y: 0,
    peerUrl: 'http://127.0.0.1:2', role: 'orbiter', region: 'earth',
  });
  graph.ingestSummary({
    from: 'Relay',
    nodes: [{ id: 'Far', eid: 'ipn:8.1', x: 8, y: 0, region: 'earth' }],
    edges: [{
      a: 'Relay', b: 'Far', delayMs: 1, schedule: openNow, originatedAt: Date.now(), hopCount: 0,
    }],
  });
  const sum = graph.exportSummary();
  assert.equal(sum.edges.every((e) => e.direct === true || e.a === 'Handset' || e.b === 'Handset'), true);
  assert.equal(sum.nodes.some((n) => n.id === 'Far'), false);
});
```

在 `finally` 里 `delete process.env.DTN_REGION` 等。`applyJoin` 在测试里对同区仍直接调用；生产路径必须先 `evaluateJoin`。

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w @yinghuo/relay -- src/graph/graph.service.test.ts`

Expected: FAIL (`evaluateJoin` is not a function).

- [ ] **Step 3: Implement**

`JoinRemote` 增加 `region?: string; tier?: string`。

`GraphService` 增加 `private gateways = new Map<string, RegionGateway>()`。

```typescript
evaluateJoin(remote: JoinRemote) {
  const partitioning = regionEnabled();
  const mine = localRegion() ?? '';
  const remoteTier = parseTier(remote.tier, remote.role);
  return joinAllowed({
    partitioning,
    localRegion: mine,
    remoteRegion: remote.region,
    localTier: localTier(process.env, this.cfg.role),
    remoteTier,
    regionPeerKeys: Object.keys(parseRegionPeers(process.env.DTN_REGION_PEERS)),
  });
}
```

`applyJoin`：在 `upsertDirectPeer` 的 node 上写入 `region: remote.region ?? localRegion() ?? undefined`、`tier: parseTier(remote.tier, remote.role)`。若 `remote.region` 非空且不等于 `localRegion()`，`this.gateways.set(remote.region, { region: remote.region, nodeId: remote.nodeId, eid: remote.eid })`。

`ingestSummary`：调用 `mergeSummary(..., { maxHop: GRAPH_MAX_HOP, now, localRegion: localRegion() })`。合并 `summary.gateways` 到 `this.gateways`（同 `region` 后者覆盖）。不要把外区叶子写进 `eidByNode`（只遍历 merge 后仍在的 nodes）。

`exportSummary`：

- 基线：现有 nodes/edges。
- `regionEnabled() && localTier(...)==='edge'`：nodes = self + 直连 peer 对应节点；edges = `direct` 且 incident to self。
- `regionEnabled() && backbone`：`gateways: [...this.gateways.values()]`。
- 每个导出 node 填上 `region: node.region ?? localRegion() ?? undefined`、`tier`。

`listGateways()` 返回 `[...this.gateways.values()]`。

Controller `peerJoin`：`const decision = graph.evaluateJoin(body); if (!decision.ok) throw new ForbiddenException({ ok: false, error: decision.error });` 然后再 `applyJoin`。

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay -- src/graph/graph.service.test.ts src/graph/graph-http.test.ts`

Expected: PASS. 未设 `DTN_REGION` 的 join HTTP 测试仍绿。

- [ ] **Step 5: Commit only if the user asked**

---

### Task 4: edge 上行与 dstRegion 区门

**Files:**
- Modify: `apps/relay/src/graph/graph-route.ts`
- Modify: `apps/relay/src/graph/graph-route.test.ts`
- Modify: `apps/relay/src/graph/graph.service.ts` `decide()` 把 `dstRegion`／`meTier`／`gateways`／`partitioning` 传入

**Interfaces:**
- Consumes: `parseTier`、`NodeTier`、`RegionGateway`
- Produces: `decideNextHop` 增加可选 `dstRegion?: string`、`meTier?: NodeTier`、`partitioning?: boolean`、`gateways?: RegionGateway[]`。未知 dst 且无门：`reason: 'no region gateway'`（仅当 `dstRegion` 已设）。未知 dst 且无 `dstRegion`：仍 `'destination not in local graph'`。

- [ ] **Step 1: Write the failing test**

Append to `graph-route.test.ts`（复用文件里的 `openNow`／`upsertNode`／`upsertEdge`）：

```typescript
test('unknown dst with dstRegion uses gateway nextHop', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter', region: 'earth' });
  upsertNode(graph, { id: 'MarsGw', eid: 'ipn:3.1', x: 10, y: 0, role: 'orbiter', region: 'earth' });
  upsertEdge(graph, {
    a: 'EarthGw', b: 'MarsGw', delayMs: 5, schedule: openNow, originatedAt: 1, hopCount: 0, direct: true,
  });
  const d = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: ['MarsGw'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'orbiter',
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [{ region: 'mars', nodeId: 'MarsGw', eid: 'ipn:3.1' }],
  });
  assert.equal(d.nextHop, 'MarsGw');
});

test('unknown dst with dstRegion and no gateway', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'EarthGw', eid: 'ipn:1.1', x: 0, y: 0, role: 'orbiter' });
  const d = decideNextHop({
    me: 'EarthGw',
    dst: 'PhobosCam',
    graph,
    peerIds: [],
    unhealthy: new Set(),
    now: 0,
    partitioning: true,
    meTier: 'backbone',
    dstRegion: 'mars',
    gateways: [],
  });
  assert.equal(d.nextHop, null);
  assert.equal(d.reason, 'no region gateway');
});

test('edge skips CGR and picks backbone peer', () => {
  const graph = emptyGraph();
  upsertNode(graph, { id: 'Phone', eid: 'ipn:4.1', x: 0, y: 0, role: 'lander', tier: 'edge' });
  upsertNode(graph, { id: 'Relay', eid: 'ipn:2.1', x: 1, y: 0, role: 'orbiter', tier: 'backbone' });
  upsertNode(graph, { id: 'Mars', eid: 'ipn:3.1', x: 50, y: 0, role: 'lander' });
  upsertEdge(graph, {
    a: 'Phone', b: 'Relay', delayMs: 1, schedule: openNow, originatedAt: 1, hopCount: 0, direct: true,
  });
  const d = decideNextHop({
    me: 'Phone',
    dst: 'Mars',
    graph,
    peerIds: ['Relay'],
    unhealthy: new Set(),
    now: 0,
    meRole: 'lander',
    partitioning: true,
    meTier: 'edge',
  });
  assert.equal(d.nextHop, 'Relay');
  assert.equal(d.algo, 'edge-uplink');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w @yinghuo/relay -- src/graph/graph-route.test.ts`

Expected: FAIL（未知 dst 仍是 `destination not in local graph`）。

- [ ] **Step 3: Implement**

在 `decideNextHop` **现有** `dstNode === undefined` 早退之前插入：

1. 若 `partitioning && meTier === 'edge'`：在 `peerIds` 中找 `!unhealthy`、图中 `parseTier(node.tier, node.role)==='backbone'`、存在 `edgeKey(me,id)` 的邻居；按现有 SABR `waitMs+delayMs+rolePenalty` 取最小者；`algo: 'edge-uplink'`；一个都没有则 `nextHop: null`，`reason: 'no backbone uplink'`。**不要**调用 `contactGraphRoute`。`dst` 是否在图中不影响 edge 上行（始终交给骨干）。

2. 否则若 `dstNode === undefined`：
   - 无 `dstRegion`：保持现有 `destination not in local graph`。
   - 有 `dstRegion`：在 `gateways` 里找 `g.region === dstRegion`；没有 → `reason: 'no region gateway'`。有则把 `dst` 改写为 `g.nodeId` 再走后面的 CGR／SABR（若门节点也不在图且它是 direct peer，`nextHop = g.nodeId`）。

`GraphNode` 的 `tier` 已在 Task 2 类型上。`GraphService.decide(dst, now, dstRegion?)` 传入 `partitioning: regionEnabled()`、`meTier: localTier(process.env, this.cfg.role)`、`gateways: this.listGateways()`、`dstRegion`。

`BundleService.pickNext` 把 `bundle.dstRegion` 传给 `graph.decide`（Task 5 若尚未加字段，本任务 `decide` 第三参可选，`pickNext` 可在 Task 5 接线）。

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay -- src/graph/graph-route.test.ts src/graph/graph-cgr.test.ts`

Expected: PASS。未传 `partitioning` 的旧测试路径不变。

- [ ] **Step 5: Commit only if the user asked**

---

### Task 5: dstRegion 与分区副本

**Files:**
- Modify: `apps/relay/src/bundle/bundle.types.ts`（`dstRegion?`）
- Modify: `apps/relay/src/bundle/bundle.service.ts`（`send`／`fromTracked`／`pickNext`／`replicaCount` 调用／`replicaCandidates` 过滤）
- Modify: `apps/relay/src/bundle/replica-select.ts`（`replicaCount` 增加可选上下文）
- Modify: `apps/relay/src/bundle/replica-select.test.ts`
- Modify: `apps/relay/src/relay/relay.controller.ts`（send body／`x-dtn-dst-region`；ingest 头写入 bundle）
- Modify: `apps/relay/src/peer/peer.service.ts`（forwardTo 带 `x-dtn-dst-region` 若存在）
- Create: `apps/relay/src/bundle/region-replica.test.ts`（或扩 `replica-forward.test.ts`）

**Interfaces:**
- Consumes: `regionEnabled`、`localTier`、`parseTier`、`graph.decide(dst, now, dstRegion)`
- Produces:
  - `replicaCount(env, opts?: { partitioning?: boolean; tier?: NodeTier }): number` — 仅当 `partitioning && tier==='edge' && env.DTN_REPLICA_N` 为空时返回 `0`，否则旧逻辑
  - `RelayBundle.dstRegion?: string`
  - `send(dst, payload, ttlMs, dstRegion?)` 或从 controller 传入

- [ ] **Step 1: Write the failing tests**

`replica-select.test.ts` 增加：

```typescript
test('edge default replica n is 0 only when partitioning', () => {
  assert.equal(replicaCount({}, { partitioning: true, tier: 'edge' }), 0);
  assert.equal(replicaCount({ DTN_REPLICA_N: '2' }, { partitioning: true, tier: 'edge' }), 2);
  assert.equal(replicaCount({}, { partitioning: false, tier: 'edge' }), 2);
});
```

`region-replica.test.ts`：MemoryStore 与 `replica-forward.test.ts` 相同骨架；`graphMode: true`。构造 `BundleService`，`process.env.DTN_REGION='earth'`，`DTN_TIER='edge'`，`send` 后 **没有** `REPLICA` 事件（peer fetch 可 mock 成 throw，断言未调用或 replicas 仍 `[]`）。再测 `send(..., dstRegion)` 写入 `bundle.dstRegion`。

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w @yinghuo/relay -- src/bundle/replica-select.test.ts src/bundle/region-replica.test.ts`

Expected: FAIL（`replicaCount` 仍返回 2）。

- [ ] **Step 3: Implement**

`replicaCount`：

```typescript
export function replicaCount(
  env: Record<string, string | undefined> = process.env,
  opts?: { partitioning?: boolean; tier?: NodeTier },
): number {
  const raw = env.DTN_REPLICA_N;
  if (raw === undefined || raw === '') {
    if (opts?.partitioning && opts.tier === 'edge') return 0;
    return 2;
  }
  // existing Number parse...
}
```

`BundleService` 里所有 `replicaCount()` 改为 `replicaCount(process.env, { partitioning: regionEnabled(), tier: localTier(process.env, this.cfg.role) })`。

`replicaCandidates`：若 `regionEnabled()`，只保留 `parseTier(node.tier, role)==='backbone'` 且 `(node.region ?? localRegion())` 等于本区（缺 region 算本区）。

`RelayBundle.dstRegion?`；`fromTracked` 第四参 `orig` 已有则抄 `dstRegion`。`stageSend` 增加可选 `dstRegion` 写入束。`send` 签名增加可选第 4 参，或 overload：`send(dst, payload, ttlMs, dstRegion?)`。

`pickNext`：`this.graph.decide(dst, now, bundle.dstRegion)`。

Controller `send`：`body.dstRegion`；`peerIngest`：`x-dtn-dst-region` 写入 bundle（与 sha256 头一样只信头，不猜）。`PeerService.forwardTo`：若 `bundle.dstRegion` 则加该头。

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay`

Expected: 全部 PASS（含未设 `DTN_REGION` 的 replica-forward）。

- [ ] **Step 5: Commit only if the user asked**

---

### Task 6: status 与文档

**Files:**
- Modify: `apps/relay/src/bundle/bundle.types.ts` `RelayStatus` 增加 `region: string | null; tier: NodeTier`
- Modify: `apps/relay/src/bundle/bundle.service.ts` `getStatus`
- Modify: `README.md`（能力表一行 + 环境变量三行 + 指向 spec）
- Modify: `docs/interop.md`（区域／档位／区门短节）
- Modify: `docs/fault-tolerance.md`（正向：区内图、跨区门、edge 不持全网）
- Modify: `docs/todo.md`（身份与多任务边界：区域切片勾上，注明未做跨任务 PKI）

**Interfaces:**
- Consumes: `localRegion`、`localTier`
- Produces: `GET /api/status` 的 `region`（未分区为 `null`）、`tier`（始终可推断）

- [ ] **Step 1: Write a failing assertion**

在现有 status 相关测试若无则加 `apps/relay/src/bundle/status-region.test.ts`：未设 env 时 `getStatus().region === null`；`DTN_REGION=earth` 时为 `'earth'`。用最小 BundleService harness（可抄 `store-audit.test.ts` 的 MemoryStore + `graphMode: true`）。

- [ ] **Step 2: Run to verify fail**

Run: `npm test -w @yinghuo/relay -- src/bundle/status-region.test.ts`

Expected: FAIL（无 `region` 字段）。

- [ ] **Step 3: Implement status + docs**

`getStatus` 增加 `region: localRegion()`、`tier: localTier(process.env, this.cfg.role)`。文档用中文写：`DTN_REGION`／`DTN_TIER`／`DTN_REGION_PEERS`、`x-dtn-dst-region`、未设 region 时兼容。不要承诺几亿节点实测。

- [ ] **Step 4: Run full relay tests**

Run: `npm test -w @yinghuo/relay`

Expected: all PASS.

- [ ] **Step 5: Commit only if the user asked**
