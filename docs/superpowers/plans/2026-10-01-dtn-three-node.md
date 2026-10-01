# 三节点 DTN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次落地 Earth–Relay–Mars、报文状态机，以及各节点控制台上的报文时间线。

**Architecture:** 接触窗口和报文状态放在不依赖 Nest 的纯函数里，用注入的 `now` 做测试。守护进程只负责把这些结果写入 LevelDB，并按下一跳的 URL 调用现有 `peer/ingest` 与 `peer/ack`。控制台读 `GET /api/bundles`。

**Tech Stack:** TypeScript、NestJS 10、Node.js `node:test`、`tsx`、classic-level、现有内置 HTML 控制台。

## Global Constraints

- Node `>=18`。
- 不实现完整 Bundle Protocol、分片或接触图路由算法。
- 不修改 `k8s/`。
- 不删除 `apps/relay/contact-plan.dual.json`。
- 默认接触计划是新文件 `apps/relay/contact-plan.tri.json`。
- Earth `:3101` endpoint，Relay `:3103` relay，Mars `:3102` endpoint。
- 周期 30000ms。Earth–Relay 打开区间 `[0, 10000)`。Relay–Mars 打开区间 `[15000, 25000)`。`delayMs` 为 200。
- `bandwidthBps` 只展示，不限制发送速率。
- 静止状态只有 `WAITING`、`FORWARDING`、`ARRIVED`、`ACKED`、`EXPIRED`。`STORED` 只作为时间线事件。
- 当前窗口内转发失败每 1000ms 重试一次。
- 同一 `bundle.id` 在同一节点只保留一份。
- Relay 的 `POST /api/send` 返回错误且不写库。
- CLI / SDK 只连接本机。
- 工作区目前不是 git 仓库。每条任务的 Commit 步骤先跑 `git rev-parse --is-inside-work-tree`；若失败，跳过提交，文件留在磁盘上。

## File Structure

- Create `apps/relay/src/contact/contact-window.ts`：单个周期窗口的开闭计算。
- Create `apps/relay/src/contact/contact-window.test.ts`：窗口边界。
- Create `apps/relay/src/bundle/bundle-machine.ts`：状态迁移与事件。
- Create `apps/relay/src/bundle/bundle-machine.test.ts`：单节点失败、去重、过期。
- Create `apps/relay/src/bundle/tri-scenario.test.ts`：三节点脚本化全程。
- Create `apps/relay/contact-plan.tri.json`：默认三节点计划。
- Modify `apps/relay/src/bundle/bundle.types.ts`：状态、事件、多对端 URL。
- Modify `apps/relay/src/config.ts`：默认计划改为 tri，解析 `peers`。
- Modify `apps/relay/src/contact/contact.service.ts`：返回本节点知道的全部接触。
- Modify `apps/relay/src/peer/peer.service.ts`：按 URL 转发，不再只用一个 `peerUrl`。
- Modify `apps/relay/src/bundle/bundle.service.ts`：调用状态机，保管事件，过期收件箱。
- Modify `apps/relay/src/relay/relay.controller.ts`：`GET /api/bundles` 与 `GET /api/bundles/:id`。
- Modify `apps/relay/src/console/console.page.ts`：报文列表与时间线。
- Modify `apps/relay/package.json`、根 `package.json`、`packages/dtn-cli/src/cli.ts`、`README.md`、`docs/relay-daemon-design.md`。

---

### Task 1: 测试入口

**Files:**
- Modify: `apps/relay/package.json`
- Modify: `package.json`（仓库根）

**Interfaces:**
- Consumes: 无
- Produces: `npm test -w @yinghuo/relay` 运行 `node --import tsx --test src/**/*.test.ts`

- [ ] **Step 1: 加上测试脚本**

`apps/relay/package.json` 的 `scripts` 增加：

```json
"test": "node --import tsx --test src/**/*.test.ts"
```

根 `package.json` 的 `scripts` 增加：

```json
"test:relay": "npm test -w @yinghuo/relay"
```

- [ ] **Step 2: 确认脚本能启动**

Run: `npm test -w @yinghuo/relay`
Expected: 进程退出码 0 或 1 均可，输出里不能是 `Missing script`。此时还没有测试文件时，Node 可能报 `Could not find`；那也算脚本已接上。若如此，Task 2 会补上第一个测试文件。

- [ ] **Step 3: Commit**

```bash
git rev-parse --is-inside-work-tree
git add apps/relay/package.json package.json
git commit -m "test: add relay node:test script"
```

若 `git rev-parse` 失败，跳过 add 与 commit。

---

### Task 2: 周期窗口

**Files:**
- Create: `apps/relay/src/contact/contact-window.ts`
- Test: `apps/relay/src/contact/contact-window.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export function isCyclicOpen(
  now: number,
  schedule: { periodMs: number; openOffsetMs: number; openDurationMs: number }
): boolean
```

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCyclicOpen } from './contact-window';

const schedule = { periodMs: 30000, openOffsetMs: 0, openDurationMs: 10000 };

test('open at start and closed at duration', () => {
  assert.equal(isCyclicOpen(0, schedule), true);
  assert.equal(isCyclicOpen(9999, schedule), true);
  assert.equal(isCyclicOpen(10000, schedule), false);
  assert.equal(isCyclicOpen(30000, schedule), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w @yinghuo/relay`
Expected: FAIL，`Cannot find module './contact-window'`

- [ ] **Step 3: 实现**

```ts
export function isCyclicOpen(
  now: number,
  schedule: { periodMs: number; openOffsetMs: number; openDurationMs: number }
): boolean {
  const elapsed = ((now % schedule.periodMs) + schedule.periodMs) % schedule.periodMs;
  return elapsed >= schedule.openOffsetMs && elapsed < schedule.openOffsetMs + schedule.openDurationMs;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -w @yinghuo/relay`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/contact/contact-window.ts apps/relay/src/contact/contact-window.test.ts
git commit -m "feat: add cyclic contact window helper"
```

---

### Task 3: 报文状态机

**Files:**
- Create: `apps/relay/src/bundle/bundle-machine.ts`
- Modify: `apps/relay/src/bundle/bundle.types.ts`
- Test: `apps/relay/src/bundle/bundle-machine.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export type BundleState = 'WAITING' | 'FORWARDING' | 'ARRIVED' | 'ACKED' | 'EXPIRED';

export interface BundleEvent {
  t: number;
  node: string;
  kind: 'STORED' | 'WAITING' | 'FORWARD' | 'RETRY' | 'ARRIVED' | 'ACKED' | 'EXPIRED';
  msg: string;
}

export interface TrackedBundle {
  id: string;
  src: string;
  dst: string;
  payload: string;
  createdAt: number;
  ttlMs: number;
  state: BundleState;
  custodian: string;
  hops: Array<{ from: string; to: string; at: number }>;
  events: BundleEvent[];
}

export function createBundle(input: {
  id: string; src: string; dst: string; payload: string; createdAt: number; ttlMs: number; contactOpen: boolean;
}): TrackedBundle

export function markExpired(bundle: TrackedBundle, now: number, node: string): TrackedBundle
export function noteForwardFailed(bundle: TrackedBundle, now: number, node: string, reason: string): TrackedBundle
export function acceptIngest(existing: TrackedBundle | undefined, incoming: TrackedBundle, now: number, node: string, atDestination: boolean): TrackedBundle
export function applyAck(bundle: TrackedBundle, now: number, node: string, from: string, downstreamEvents: BundleEvent[]): TrackedBundle
export function shouldRetry(lastRetryAt: number | null, now: number): boolean
```

`shouldRetry` 在 `lastRetryAt === null` 或 `now - lastRetryAt >= 1000` 时返回 true。

`createBundle` 追加一条 `kind: 'STORED'` 事件，然后 `state` 为 `contactOpen ? 'FORWARDING' : 'WAITING'`。`acceptIngest` 在 `existing` 已有同一 id 时返回 `existing`，不追加第二份。`markExpired` 把 `state` 设为 `EXPIRED`。`noteForwardFailed` 把 `FORWARDING` 改回 `WAITING` 并追加 `RETRY`。`applyAck` 把保管方设为 `ACKED`，并把 `downstreamEvents` 里尚未出现的事件按 `t` 再按 `kind` 合并进 `events`。

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptIngest, applyAck, createBundle, markExpired, noteForwardFailed, shouldRetry } from './bundle-machine';

test('closed contact stores as WAITING and records STORED event', () => {
  const bundle = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: false,
  });
  assert.equal(bundle.state, 'WAITING');
  assert.equal(bundle.events[0].kind, 'STORED');
  assert.equal(bundle.events[0].node, 'Earth');
});

test('duplicate ingest keeps one copy', () => {
  const first = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const again = acceptIngest(first, first, 10, 'Relay', false);
  assert.equal(again.events.length, first.events.length);
  assert.equal(again.state, first.state);
});

test('forward failure returns to WAITING', () => {
  const live = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const failed = noteForwardFailed(live, 1000, 'Earth', 'peer down');
  assert.equal(failed.state, 'WAITING');
  assert.equal(failed.events.at(-1)?.kind, 'RETRY');
});

test('ttl expiry is terminal', () => {
  const live = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 1000, contactOpen: false,
  });
  const dead = markExpired(live, 1000, 'Relay');
  assert.equal(dead.state, 'EXPIRED');
});

test('ack merges downstream arrival', () => {
  const held = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 0, ttlMs: 120000, contactOpen: true,
  });
  const acked = applyAck(held, 50, 'Earth', 'Relay', [
    { t: 40, node: 'Mars', kind: 'ARRIVED', msg: 'inbox' },
  ]);
  assert.equal(acked.state, 'ACKED');
  assert.equal(acked.events.some((e) => e.kind === 'ARRIVED' && e.node === 'Mars'), true);
});

test('retry waits 1000ms', () => {
  assert.equal(shouldRetry(null, 0), true);
  assert.equal(shouldRetry(0, 999), false);
  assert.equal(shouldRetry(0, 1000), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w @yinghuo/relay`
Expected: FAIL，`Cannot find module './bundle-machine'`

- [ ] **Step 3: 实现 `bundle-machine.ts`**

```ts
export type BundleState = 'WAITING' | 'FORWARDING' | 'ARRIVED' | 'ACKED' | 'EXPIRED';

export interface BundleEvent {
  t: number;
  node: string;
  kind: 'STORED' | 'WAITING' | 'FORWARD' | 'RETRY' | 'ARRIVED' | 'ACKED' | 'EXPIRED';
  msg: string;
}

export interface TrackedBundle {
  id: string;
  src: string;
  dst: string;
  payload: string;
  createdAt: number;
  ttlMs: number;
  state: BundleState;
  custodian: string;
  hops: Array<{ from: string; to: string; at: number }>;
  events: BundleEvent[];
}

function withEvent(bundle: TrackedBundle, event: BundleEvent): TrackedBundle {
  return { ...bundle, events: [...bundle.events, event] };
}

export function createBundle(input: {
  id: string; src: string; dst: string; payload: string; createdAt: number; ttlMs: number; contactOpen: boolean;
}): TrackedBundle {
  const state: BundleState = input.contactOpen ? 'FORWARDING' : 'WAITING';
  return {
    id: input.id,
    src: input.src,
    dst: input.dst,
    payload: input.payload,
    createdAt: input.createdAt,
    ttlMs: input.ttlMs,
    state,
    custodian: input.src,
    hops: [],
    events: [
      { t: input.createdAt, node: input.src, kind: 'STORED', msg: 'persisted' },
      { t: input.createdAt, node: input.src, kind: state === 'WAITING' ? 'WAITING' : 'FORWARD', msg: state },
    ],
  };
}

export function markExpired(bundle: TrackedBundle, now: number, node: string): TrackedBundle {
  if (bundle.state === 'EXPIRED' || bundle.state === 'ACKED') return bundle;
  return withEvent({ ...bundle, state: 'EXPIRED' }, { t: now, node, kind: 'EXPIRED', msg: 'ttl' });
}

export function noteForwardFailed(bundle: TrackedBundle, now: number, node: string, reason: string): TrackedBundle {
  return withEvent({ ...bundle, state: 'WAITING' }, { t: now, node, kind: 'RETRY', msg: reason });
}

export function acceptIngest(
  existing: TrackedBundle | undefined,
  incoming: TrackedBundle,
  now: number,
  node: string,
  atDestination: boolean
): TrackedBundle {
  if (existing) return existing;
  if (atDestination) {
    return withEvent(
      { ...incoming, state: 'ARRIVED', custodian: node },
      { t: now, node, kind: 'ARRIVED', msg: 'inbox' }
    );
  }
  return withEvent(
    { ...incoming, state: 'WAITING', custodian: node },
    { t: now, node, kind: 'STORED', msg: `accepted at ${node}` }
  );
}

export function applyAck(
  bundle: TrackedBundle,
  now: number,
  node: string,
  from: string,
  downstreamEvents: BundleEvent[]
): TrackedBundle {
  const seen = new Set(bundle.events.map((e) => `${e.t}|${e.node}|${e.kind}|${e.msg}`));
  const merged = [...bundle.events];
  for (const event of downstreamEvents) {
    const key = `${event.t}|${event.node}|${event.kind}|${event.msg}`;
    if (!seen.has(key)) merged.push(event);
  }
  merged.push({ t: now, node, kind: 'ACKED', msg: `acked by ${from}` });
  merged.sort((a, b) => a.t - b.t);
  return { ...bundle, state: 'ACKED', events: merged };
}

export function shouldRetry(lastRetryAt: number | null, now: number): boolean {
  if (lastRetryAt === null) return true;
  return now - lastRetryAt >= 1000;
}
```

在 `bundle.types.ts` 的 `RelayBundle` 上增加可选字段，供守护进程持久化同一形状：

```ts
state?: 'WAITING' | 'FORWARDING' | 'ARRIVED' | 'ACKED' | 'EXPIRED';
custodian?: string;
events?: Array<{ t: number; node: string; kind: string; msg: string }>;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -w @yinghuo/relay`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/bundle/bundle-machine.ts apps/relay/src/bundle/bundle-machine.test.ts apps/relay/src/bundle/bundle.types.ts
git commit -m "feat: add bundle state machine"
```

---

### Task 4: 三节点脚本场景

**Files:**
- Test: `apps/relay/src/bundle/tri-scenario.test.ts`

**Interfaces:**
- Consumes: `isCyclicOpen`、`createBundle`、`acceptIngest`、`applyAck`、`noteForwardFailed`、`markExpired`
- Produces: 无新导出。测试本身就是 spec 里「只开一段、再开下一段、确认回到 Earth」的可执行说明。

- [ ] **Step 1: 写场景测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCyclicOpen } from '../contact/contact-window';
import { acceptIngest, applyAck, createBundle, noteForwardFailed } from './bundle-machine';

const earthRelay = { periodMs: 30000, openOffsetMs: 0, openDurationMs: 10000 };
const relayMars = { periodMs: 30000, openOffsetMs: 15000, openDurationMs: 10000 };

test('bundle waits on Relay until the second contact, then Earth sees ARRIVED', () => {
  assert.equal(isCyclicOpen(1000, earthRelay), true);
  assert.equal(isCyclicOpen(1000, relayMars), false);

  const created = createBundle({
    id: 'Earth-1', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 1000, ttlMs: 120000, contactOpen: true,
  });
  const atRelay = acceptIngest(undefined, created, 1200, 'Relay', false);
  assert.equal(atRelay.state, 'WAITING');
  assert.equal(atRelay.custodian, 'Relay');

  const earthAfterFirstAck = applyAck(created, 1300, 'Earth', 'Relay', atRelay.events);
  assert.equal(earthAfterFirstAck.state, 'ACKED');
  assert.equal(earthAfterFirstAck.events.some((e) => e.node === 'Mars' && e.kind === 'ARRIVED'), false);

  assert.equal(isCyclicOpen(16000, relayMars), true);
  const atMars = acceptIngest(undefined, atRelay, 16000, 'Mars', true);
  assert.equal(atMars.state, 'ARRIVED');

  const relayAcked = applyAck(atRelay, 16100, 'Relay', 'Mars', atMars.events);
  const earthDone = applyAck(earthAfterFirstAck, 16200, 'Earth', 'Relay', relayAcked.events);
  assert.equal(earthDone.events.some((e) => e.node === 'Mars' && e.kind === 'ARRIVED'), true);
});

test('down peer does not move the bundle', () => {
  const created = createBundle({
    id: 'Earth-2', src: 'Earth', dst: 'Mars', payload: 'hi', createdAt: 1000, ttlMs: 120000, contactOpen: true,
  });
  const stuck = noteForwardFailed(created, 2000, 'Earth', 'ECONNREFUSED');
  assert.equal(stuck.custodian, 'Earth');
  assert.equal(stuck.state, 'WAITING');
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npm test -w @yinghuo/relay`
Expected: PASS。这一任务不新增生产代码；若失败，只修正测试里对 Task 3 返回值的假设，不放宽断言。

- [ ] **Step 3: Commit**

```bash
git add apps/relay/src/bundle/tri-scenario.test.ts
git commit -m "test: cover three-node store-and-forward scenario"
```

---

### Task 5: 三节点接触计划与配置

**Files:**
- Create: `apps/relay/contact-plan.tri.json`
- Modify: `apps/relay/src/config.ts`
- Modify: `apps/relay/src/bundle/bundle.types.ts` 的 `DualNodeConfig`

**Interfaces:**
- Consumes: 现有 `loadRelayConfig`
- Produces: `RelayRuntimeConfig.peers: Record<string, string>`，以及 `peerUrlFor(nextHopName: string): string` 放在 `config.ts` 并导出。`resolvePlanPath` 在未设置 `CONTACT_PLAN` 时优先 `contact-plan.tri.json`。

`DualNodeConfig` 增加可选 `peers?: Record<string, string>`。`peerUrl` 仍保留，供旧的 dual 计划使用。`peerUrlFor` 先查 `peers[name]`，没有则在只有一个邻居时回退到 `peerUrl`。

- [ ] **Step 1: 写计划文件**

```json
{
  "description": "Earth–Relay–Mars staggered contacts",
  "mode": "tri",
  "nodes": [
    {
      "name": "Earth",
      "role": "endpoint",
      "port": 3101,
      "peerUrl": "http://127.0.0.1:3103",
      "peers": { "Relay": "http://127.0.0.1:3103" },
      "nextHop": { "Mars": "Relay", "Relay": "Relay" }
    },
    {
      "name": "Relay",
      "role": "relay",
      "port": 3103,
      "peerUrl": "http://127.0.0.1:3102",
      "peers": {
        "Earth": "http://127.0.0.1:3101",
        "Mars": "http://127.0.0.1:3102"
      },
      "nextHop": { "Mars": "Mars", "Earth": "Earth" }
    },
    {
      "name": "Mars",
      "role": "endpoint",
      "port": 3102,
      "peerUrl": "http://127.0.0.1:3103",
      "peers": { "Relay": "http://127.0.0.1:3103" },
      "nextHop": { "Earth": "Relay", "Relay": "Relay" }
    }
  ],
  "contacts": [
    {
      "a": "Earth",
      "b": "Relay",
      "delayMs": 200,
      "bandwidthBps": 1000000,
      "schedule": { "type": "cyclic", "periodMs": 30000, "openOffsetMs": 0, "openDurationMs": 10000 }
    },
    {
      "a": "Relay",
      "b": "Mars",
      "delayMs": 200,
      "bandwidthBps": 1000000,
      "schedule": { "type": "cyclic", "periodMs": 30000, "openOffsetMs": 15000, "openDurationMs": 10000 }
    }
  ]
}
```

- [ ] **Step 2: 改 `resolvePlanPath` 的候选列表**

把 `contact-plan.tri.json` 放在每个现有 `contact-plan.dual.json` 候选路径之前。未设置 `CONTACT_PLAN` 时命中 tri 文件。

- [ ] **Step 3: 导出 `peerUrlFor`**

在 `loadRelayConfig` 的返回值里加入 `peers: node.peers ?? {}`。

```ts
export function peerUrlFor(cfg: RelayRuntimeConfig, nextHopName: string): string {
  const fromMap = cfg.peers[nextHopName];
  if (fromMap) return fromMap;
  return cfg.peerUrl;
}
```

- [ ] **Step 4: 用 Node 检查计划能被当前进程读到**

Run: `NODE_ID=Relay PORT=3103 node --import tsx -e "const {loadRelayConfig}=require('./apps/relay/src/config.ts'); const c=loadRelayConfig(); if(c.nodeId!=='Relay'||c.peers.Mars!=='http://127.0.0.1:3102') process.exit(1)"`
工作目录：`dtn-demo`。
Expected: 退出码 0。

- [ ] **Step 5: Commit**

```bash
git add apps/relay/contact-plan.tri.json apps/relay/src/config.ts apps/relay/src/bundle/bundle.types.ts
git commit -m "feat: add three-node contact plan"
```

---

### Task 6: 多段接触服务

**Files:**
- Modify: `apps/relay/src/contact/contact.service.ts`

**Interfaces:**
- Consumes: `isCyclicOpen`，`cfg.plan.contacts`
- Produces:

```ts
export interface ContactLinkState {
  a: string;
  b: string;
  peer: string;
  local: boolean;
  open: boolean;
  delayMs: number;
  schedule: CyclicSchedule;
  nextChangeAt: number;
  phase: string;
  bandwidthBps?: number;
}

listLinks(now?: number): ContactLinkState[]
isOpenTo(nextHopName: string, now?: number): boolean
delayTo(nextHopName: string): number
```

`local` 为真当且仅当本节点是 `a` 或 `b`。Earth 看 Relay–Mars 时 `local` 为 false，`open` 仍按日程计算。`isOpenTo` 只对 `local === true` 且对端名字匹配的接触返回窗口状态；没有这样的接触时返回 false。

保留现有 `getState()`：返回第一条 `local` 接触，避免现有控制台字段突然变成 undefined。`getPeerName()` 仍返回那一条的对端。

- [ ] **Step 1: 替换构造函数里「只找一条接触」的逻辑**

构造函数保存 `cfg.plan.contacts` 全表。找不到任何包含本节点的接触时仍抛出 `No contact involving ${nodeId}`。

- [ ] **Step 2: 实现 `listLinks`**

对每条接触调用 `isCyclicOpen(now, schedule)`。`phase` 文案沿用现有 `getState` 的 OPEN / CLOSED 句子。`nextChangeAt` 的计算从现有 `getState` 复制，输入改为该条接触的 schedule。

- [ ] **Step 3: 跑现有测试**

Run: `npm test -w @yinghuo/relay`
Expected: PASS。本任务不新增测试文件；窗口数学已由 Task 2 覆盖。

- [ ] **Step 4: Commit**

```bash
git add apps/relay/src/contact/contact.service.ts
git commit -m "feat: list every contact known to a node"
```

---

### Task 7: 按下一跳转发

**Files:**
- Modify: `apps/relay/src/peer/peer.service.ts`
- Modify: `apps/relay/src/bundle/bundle.service.ts`
- Modify: `apps/relay/src/relay/relay.controller.ts` 的 ingest 503 条件

**Interfaces:**
- Consumes: `peerUrlFor`，`isOpenTo`，`createBundle`，`acceptIngest`，`noteForwardFailed`，`markExpired`，`applyAck`
- Produces: `PeerService.forwardTo(url, bundle)`。`BundleService` 持久化 `state`、`custodian`、`events`。ingest 对已存在的 id 返回 `{ accepted: true, delivered, duplicate: true }`，不写第二份。

- [ ] **Step 1: `forwardTo`**

把 `forwardToPeer` 改成接受目标 URL：

```ts
async forwardTo(url: string, bundle: RelayBundle): Promise<{ ok: boolean; body?: PeerIngestResult; error?: string }> {
  const res = await fetch(`${url}/api/peer/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bundle, from: this.cfg.nodeId }),
  });
  const body = (await res.json()) as PeerIngestResult;
  if (!res.ok) return { ok: false, body, error: `HTTP ${res.status}` };
  return { ok: true, body };
}
```

`sendAck` 已接受 `toUrl`，保持不变。

- [ ] **Step 2: 发送与转发使用状态机**

`send` 在 `role === 'relay'` 时继续抛出 `role=relay cannot inject application traffic`，且不调用 `putBundle`。

创建报文时：

```ts
const next = this.cfg.nextHop[dst] ?? dst;
const contactOpen = this.contacts.isOpenTo(next, now);
const tracked = createBundle({ id, src: this.cfg.nodeId, dst, payload, createdAt: now, ttlMs, contactOpen });
```

把 `tracked.state`、`tracked.custodian`、`tracked.events` 写进 `RelayBundle` 再 `putBundle`。

`tryForward`：

- `now - createdAt >= ttlMs` 时 `markExpired`，释放 custody，并从收件箱删掉同一 id（调用 store 里已有的 inbox 删除；若没有删除方法，在 `level-store.ts` 增加 `dropInbox(id: string): void`，从内存 inbox 数组过滤该 id）。
- 下一跳窗口关闭：把状态写成 `WAITING`，直接返回。
- 窗口打开：`forwardTo(peerUrlFor(this.cfg, next), bundle)`。
- `ok === false`：`noteForwardFailed`，custody `waitingAck` 设回 false。
- `ok === true`：状态保持 `FORWARDING`，直到 `onAck`。不要在 2 秒后自动清掉 `waitingAck`。
- 重试间隔：`tryForward` 开头用 `shouldRetry(lastRetryAt, now)`。`lastRetryAt` 取 `events` 里最后一条 `RETRY` 的 `t`，没有则为 `null`。返回 false 时直接返回。

`ingestFromPeer`：

- 用 bundle id 读已有记录。已有则返回 `duplicate: true`，不 `putBundle`。
- 目的地是本节点：`acceptIngest(..., atDestination: true)`，`deliverLocal`，然后 `sendAck(peerUrlFor(cfg, from), id)`。
- `role === 'endpoint'` 且目的地不是本节点：保持现有 REJECT。
- 否则 `acceptIngest(..., atDestination: false)` 并保管。确认发回 `from` 对应的 URL。

`onAck`：`applyAck(local, now, nodeId, from, [])`。下游事件由 ack 请求体带上。把 `peerAck` 的 body 扩展为 `{ bundleId, from, events? }`。`applyAck` 的 `downstreamEvents` 使用 `body.events ?? []`。发送 ack 时把本机 `bundle.events` 放进 body。

控制器里 `peer/ingest` 的 503 条件改为：按 body 里报文的下一跳检查 `isOpenTo`，而不是单个 `contacts.isOpen()`。本节点是目的地时不因「另一段窗口关闭」拒绝。

- [ ] **Step 3: 跑测试**

Run: `npm test -w @yinghuo/relay`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/relay/src/peer/peer.service.ts apps/relay/src/bundle/bundle.service.ts apps/relay/src/relay/relay.controller.ts apps/relay/src/store/level-store.ts
git commit -m "feat: forward across staggered contacts with custody acks"
```

---

### Task 8: 报文查询接口

**Files:**
- Modify: `apps/relay/src/relay/relay.controller.ts`
- Modify: `apps/relay/src/bundle/bundle.service.ts`
- Modify: `apps/relay/src/contact/contact.service.ts` 的状态输出，若 Task 6 的 `listLinks` 尚未出现在 `/api/contacts`

**Interfaces:**
- Consumes: store 中的 `RelayBundle`
- Produces:

```ts
GET /api/bundles -> { ok: true, bundles: Array<{ id, src, dst, state, custodian, updatedAt }> }
GET /api/bundles/:id -> { ok: true, bundle: RelayBundle } | { ok: false, error: 'not found' }
GET /api/contacts -> { links: ContactLinkState[], ...现有字段 }
```

`updatedAt` 取 `events` 最后一条的 `t`，没有事件时取 `createdAt`。

- [ ] **Step 1: 在 `BundleService` 增加**

```ts
async listBundles(): Promise<Array<{ id: string; src: string; dst: string; state: string; custodian: string; updatedAt: number }>>
async getBundle(id: string): Promise<RelayBundle | undefined>
```

列表来源是 custody 中仍在保管的 id，加上本进程 `recent` 数组里见过、即使已经 ACKED 的 id。`recent` 是内存数组，上限 100，在 `send`、`ingestFromPeer`、`onAck`、`markExpired` 时写入。进程重启后只保证仍在 LevelDB 里的报文还在；已 ACK 并删除的报文可以消失。这与 spec「本机看过的报文」在进程存活期间一致。

- [ ] **Step 2: 控制器**

```ts
@Get('bundles')
async bundles() {
  return { ok: true, bundles: await this.bundles.listBundles() };
}

@Get('bundles/:id')
async bundle(@Param('id') id: string) {
  const bundle = await this.bundles.getBundle(id);
  if (!bundle) return { ok: false, error: 'not found' };
  return { ok: true, bundle };
}
```

`contactsState()` 返回 `{ ...this.contacts.getState(), links: this.contacts.listLinks() }`。

- [ ] **Step 3: 跑测试**

Run: `npm test -w @yinghuo/relay`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/relay/src/relay/relay.controller.ts apps/relay/src/bundle/bundle.service.ts apps/relay/src/contact/contact.service.ts
git commit -m "feat: expose bundle timeline over HTTP"
```

---

### Task 9: 启动脚本与 CLI

**Files:**
- Modify: `apps/relay/package.json`
- Modify: `package.json`
- Modify: `packages/dtn-cli/src/cli.ts`

**Interfaces:**
- Consumes: 端口 3101 / 3103 / 3102
- Produces: `npm run relay:relay`。`DTN_NODE=Relay` 时 CLI 默认 `http://127.0.0.1:3103`。`DTN_NODE=Earth|Mars` 行为不变。

- [ ] **Step 1: 脚本**

`apps/relay/package.json`：

```json
"start:earth": "NODE_ID=Earth PORT=3101 tsx src/main.ts",
"start:relay": "NODE_ID=Relay PORT=3103 tsx src/main.ts",
"start:mars": "NODE_ID=Mars PORT=3102 tsx src/main.ts"
```

去掉写死的 `PEER_URL`，让计划文件里的 `peers` 生效。

根 `package.json` 增加 `"relay:relay": "npm run start:relay -w @yinghuo/relay"`。

- [ ] **Step 2: CLI**

`resolveUrl` 在 `node === 'relay'` 时返回 `http://127.0.0.1:3103`。帮助文本里的 `DTN_NODE=Earth|Mars` 改为 `DTN_NODE=Earth|Relay|Mars`。

- [ ] **Step 3: Commit**

```bash
git add apps/relay/package.json package.json packages/dtn-cli/src/cli.ts
git commit -m "feat: start the middle relay by default"
```

---

### Task 10: 控制台时间线

**Files:**
- Modify: `apps/relay/src/console/console.page.ts`

**Interfaces:**
- Consumes: `GET /api/bundles`、`GET /api/bundles/:id`、`GET /api/contacts` 的 `links`
- Produces: 顶栏按钮 `data-view="bundles"`，文案中文「报文」、英文 `Bundles`。详情区 `#bundle-detail`。

- [ ] **Step 1: 顶栏增加按钮**

放在「操作」和「日志」之间：

```html
<button type="button" class="nav-btn" data-view="bundles"><span class="ico">☰</span><span data-i18n="navBundles">报文</span></button>
```

中英字典增加 `navBundles: '报文' | 'Bundles'`，以及 `bundlesTitle`、`colId`、`colSrc`、`colDst`、`colState`、`colWhere`、`colUpdated`、`timeline`、`notFound`。状态显示用现有字典风格：`WAITING`→等待窗口，`FORWARDING`→转发中，`ARRIVED`→已到达，`ACKED`→已确认，`EXPIRED`→已过期。事件 `STORED` 显示为「已存储」。

- [ ] **Step 2: 视图**

```html
<section class="view" id="view-bundles">
  <h2 class="view-title" data-i18n="bundlesTitle">报文</h2>
  <table class="simple" id="bundle-table">
    <thead>
      <tr>
        <th data-i18n="colId">id</th>
        <th data-i18n="colSrc">源</th>
        <th data-i18n="colDst">目的</th>
        <th data-i18n="colState">状态</th>
        <th data-i18n="colWhere">当前节点</th>
        <th data-i18n="colUpdated">更新时间</th>
      </tr>
    </thead>
    <tbody id="bundle-rows"></tbody>
  </table>
  <div class="grid two" id="bundle-detail" hidden>
    <div class="card">
      <h3 id="bd-title">—</h3>
      <pre id="bd-meta">—</pre>
    </div>
    <div class="card stretch">
      <h3 data-i18n="timeline">时间线</h3>
      <pre id="bd-events">—</pre>
    </div>
  </div>
</section>
```

概览统计卡下方加 `<div id="ov-bundle-counts" class="hint"></div>` 和 `<table class="simple"><tbody id="ov-bundle-recent"></tbody></table>`。操作页发送成功后，若响应有 `bundle.id`，在 `#send-out` 下方放一个按钮 `#btn-open-bundle`，点击后切到 `view-bundles` 并加载该 id。

- [ ] **Step 3: 拉取与渲染**

在现有 `refresh()` 末尾调用 `refreshBundles()`。`refreshBundles` 请求 `/api/bundles`，把行写进 `#bundle-rows` 和 `#ov-bundle-recent`（最多 5 行）。计数来自 `state` 字段：WAITING、FORWARDING、ARRIVED、EXPIRED。

行点击：

```js
async function openBundle(id) {
  const res = await fetch('/api/bundles/' + encodeURIComponent(id));
  const body = await res.json();
  if (!body.ok) {
    $('bd-events').textContent = t('notFound');
    return;
  }
  $('bundle-detail').hidden = false;
  $('bd-title').textContent = body.bundle.id;
  $('bd-meta').textContent = JSON.stringify({
    state: body.bundle.state,
    src: body.bundle.src,
    dst: body.bundle.dst,
    payload: body.bundle.payload,
    custodian: body.bundle.custodian,
  }, null, 2);
  $('bd-events').textContent = (body.bundle.events || [])
    .map((e) => new Date(e.t).toISOString().slice(11, 19) + '  ' + e.node + '  ' + e.kind + '  ' + e.msg)
    .join('\n');
}
```

连接页在现有单段接触卡下面追加 `#cn-links`。对 `links` 里 `local === false` 的行显示「本机不直连」。`local === true` 的行显示 `open` 与 `phase`。

- [ ] **Step 4: 手动看页面结构**

启动三进程前，只用 Earth 也可以。Run 由 Task 11 的手动步骤覆盖。此步用浏览器打开 `http://127.0.0.1:3101/`，确认顶栏有「报文」，点开后表格存在。若中继还是旧进程，先重启 Earth。

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/console/console.page.ts
git commit -m "feat: show bundle timeline in the relay console"
```

---

### Task 11: 文档与手动验收

**Files:**
- Modify: `README.md`
- Modify: `docs/relay-daemon-design.md`

**Interfaces:**
- Consumes: 端口与计划文件名
- Produces: 读者能按 README 启动三个进程并知道旧 dual 计划如何显式启用：`CONTACT_PLAN=apps/relay/contact-plan.dual.json`。

- [ ] **Step 1: README**

快速开始改为三个终端：`npm run relay:earth`、`npm run relay:relay`、`npm run relay:mars`。端口表加入 Relay `:3103`。说明两段窗口错开。把「双中继」主标题改成三节点为主路径，dual 计划标为可选。

`docs/relay-daemon-design.md` 顶部加一段：默认路径以 `docs/superpowers/specs/2026-10-01-dtn-three-node-design.md` 为准；下文里只写 Earth↔Mars 的部分是旧的双节点模式。

- [ ] **Step 2: 自动测试**

Run: `npm run test:relay`
Expected: PASS，包含 contact window、状态机、三节点场景。

- [ ] **Step 3: 手动**

同时打开 `http://127.0.0.1:3101/`、`http://127.0.0.1:3103/`、`http://127.0.0.1:3102/`。在 Earth 操作页把目的地设为 Mars 并发送。Earth–Relay 打开后，Relay 的报文列表出现该 id，状态为等待窗口。Relay–Mars 打开后，Mars 收件箱能接收到同一载荷。Earth 的报文详情里能看到节点为 Mars、种类为 ARRIVED 的事件。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/relay-daemon-design.md
git commit -m "docs: describe the three-node relay path"
```
