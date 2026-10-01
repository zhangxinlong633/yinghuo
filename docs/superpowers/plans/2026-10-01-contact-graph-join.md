# 动态加入与局部接触图选路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 节点经引导 URL 动态加入，局部接触图经摘要扩散增长；选路为坐标过滤后取时延最小下一跳；控制台改为可变规模网络图与选路对照。

**Architecture:** 纯函数负责摘要合并与选路；`GraphService` 持有本机图、种子 peers、动态接触；`POST /api/peer/join` 与 `POST /api/peer/graph` 做加入与扩散；图模式下 `BundleService.prepareForward` 调用选路而非静态 `nextHop`。控制台连接页改坐标图，运维增加选路条。

**Tech Stack:** NestJS relay、现有接触窗口工具、BPv7/koffi（不变）、Node `node:test` + `tsx`、内置控制台 HTML/JS（SVG 或 canvas 简图）

**Spec:** `docs/superpowers/specs/2026-10-01-contact-graph-join-design.md`

## Global Constraints

- 集群规模不写死；测试时起 10 进程依次 join。
- 选路：丢掉 `dist(neighbor,dst) >= dist(me,dst)`，剩余取 `timeUntilOpen + delayMs` 最小。
- 摘要 `hopCount` 接收时 +1，默认上限 3；直连种子边 `hopCount = 0`。
- 业务载荷仍走 BPv7 CBOR；摘要与 join 用 JSON 独立 API。
- 业务 send/inbox 形状不变；网络图只在连接页；选路对照在运维。
- 不实现完整 CGR、Chord、无引导发现；不改 `k8s/`。
- 旧 `CONTACT_PLAN=.../contact-plan.tri.json` 且未开图模式时，保留静态 `nextHop` 行为。
- 图模式：`DTN_GRAPH_MODE=1`，或默认使用新的可 join 启动方式（无整表 nextHop）。

## File Structure

| Path | Responsibility |
|------|----------------|
| `apps/relay/src/graph/graph.types.ts` | 节点、边、摘要、选路结果类型 |
| `apps/relay/src/graph/graph-merge.ts` | 合并摘要、hop 裁剪 |
| `apps/relay/src/graph/graph-route.ts` | 坐标过滤 + 时延排序 |
| `apps/relay/src/graph/graph-merge.test.ts` | 合并单测 |
| `apps/relay/src/graph/graph-route.test.ts` | 选路单测 |
| `apps/relay/src/graph/graph.service.ts` | 本机图状态、peers、join、gossip、unhealthy |
| `apps/relay/src/contact/contact-window.ts` | 复用 `timeUntilOpen` 或导出辅助（若尚无则在 graph-route 内用现有 `isCyclicOpen` 算等待） |
| `apps/relay/src/config.ts` | `x,y`、`bootstrapUrl`、`graphMode`、可变 eid |
| `apps/relay/src/relay/relay.controller.ts` | `join`、`graph`、图快照 API |
| `apps/relay/src/bundle/bundle.service.ts` | 图模式选路；选路事件 |
| `apps/relay/src/console/console.page.ts` | 网络图 + 选路条 + 概览 + 目的下拉 |
| `apps/relay/scripts/join-cluster.sh` | 起引导 + N 个 join（默认 N=10） |
| `README.md` | 图模式与 join 说明 |

---

### Task 1: 摘要合并（纯函数）

**Files:**
- Create: `apps/relay/src/graph/graph.types.ts`
- Create: `apps/relay/src/graph/graph-merge.ts`
- Create: `apps/relay/src/graph/graph-merge.test.ts`

**Interfaces:**
- Produces:

```ts
export type GraphNode = { id: string; eid: string; x: number; y: number };
export type GraphEdge = {
  a: string;
  b: string;
  delayMs: number;
  schedule: CyclicSchedule; // reuse from bundle.types
  originatedAt: number;
  hopCount: number;
  direct?: boolean;
};
export type GraphSummary = { from: string; nodes: GraphNode[]; edges: GraphEdge[] };
export type LocalGraph = { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> }; // edge key: sorted "a|b"

export function edgeKey(a: string, b: string): string;
export function mergeSummary(
  local: LocalGraph,
  incoming: GraphSummary,
  opts: { maxHop: number; now: number }
): LocalGraph;
```

- [ ] **Step 1: Write failing tests**

```ts
test('keeps newer originatedAt and drops hopCount above max', () => {
  const local = emptyGraph();
  const once = mergeSummary(local, {
    from: 'B',
    nodes: [{ id: 'C', eid: 'ipn:3.1', x: 3, y: 0 }],
    edges: [{ a: 'B', b: 'C', delayMs: 100, schedule: sched, originatedAt: 10, hopCount: 0 }],
  }, { maxHop: 3, now: 100 });
  assert.equal(once.edges.get(edgeKey('B', 'C'))?.hopCount, 1);
  const tooFar = mergeSummary(once, {
    from: 'X',
    nodes: [],
    edges: [{ a: 'Y', b: 'Z', delayMs: 1, schedule: sched, originatedAt: 20, hopCount: 3 }],
  }, { maxHop: 3, now: 100 });
  assert.equal(tooFar.edges.has(edgeKey('Y', 'Z')), false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -w @lightlink/relay -- src/graph/graph-merge.test.ts`

- [ ] **Step 3: Implement merge**

接收边：`hopCount = incoming.hopCount + 1`；若 `> maxHop` 丢弃。直连插入用 `direct: true, hopCount: 0` 的单独 API 或 merge 前先 `upsertDirectEdge`。同 key 比较 `originatedAt`。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/graph/graph.types.ts apps/relay/src/graph/graph-merge.ts apps/relay/src/graph/graph-merge.test.ts
git commit -m "feat: merge contact-graph summaries with hop limits"
```

---

### Task 2: 选路纯函数

**Files:**
- Create: `apps/relay/src/graph/graph-route.ts`
- Create: `apps/relay/src/graph/graph-route.test.ts`
- Modify: `apps/relay/src/contact/contact-window.ts`（若需导出 `msUntilOpen(now, schedule)`；没有则在 graph-route 内实现并用测试钉住）

**Interfaces:**
- Consumes: `LocalGraph`, `isCyclicOpen` / new `msUntilOpen`
- Produces:

```ts
export type RouteCandidate = {
  neighbor: string;
  distMe: number;
  distNb: number;
  waitMs: number;
  delayMs: number;
  costMs: number;
  closer: boolean;
};
export type RouteDecision = {
  nextHop: string | null;
  reason: string;
  candidates: RouteCandidate[];
  culled: RouteCandidate[]; // closer === false
};

export function distance(ax: number, ay: number, bx: number, by: number): number;
export function decideNextHop(input: {
  me: string;
  dst: string;
  graph: LocalGraph;
  peerIds: string[]; // neighbors with URL
  unhealthy: Set<string>;
  now: number;
}): RouteDecision;
```

- [ ] **Step 1: Failing test**

```ts
test('culls farther neighbors then picks lowest wait+delay', () => {
  // me at 0, dst at 10; A at 3 (closer), B at 8 (closer), C at -1 (farther)
  // A wait 5000 delay 100; B wait 0 delay 200 → pick B
});
```

- [ ] **Step 2: Run FAIL**

- [ ] **Step 3: Implement**

无 dst 坐标 → `nextHop: null, reason: 'destination not in local graph'`。

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: choose next hop by distance filter then delay cost"
```

---

### Task 3: GraphService 与配置

**Files:**
- Create: `apps/relay/src/graph/graph.service.ts`
- Modify: `apps/relay/src/config.ts`
- Modify: `apps/relay/src/relay/relay.module.ts` / `app.module.ts`（注册 provider）
- Modify: `apps/relay/src/bundle/bundle.types.ts`（节点可选 `x,y`；图模式可不要求 nextHop）

**Interfaces:**
- Produces `GraphService`:
  - `snapshot()` → 供控制台：nodes、edges（含 direct/heard）、peers、stats
  - `applyJoin(remote)` / `buildJoinResponse()`
  - `ingestSummary(summary)`
  - `exportSummary(): GraphSummary`
  - `decide(dst, now): RouteDecision`
  - `markUnhealthy(id)` / `peerUrl(id)`
  - `listKnownNodeIds(): string[]`
  - `upsertDirectPeer(id, url, node, edgeSchedule)`
- Config: `graphMode: boolean`, `x: number`, `y: number`, `bootstrapUrl?: string`, `eid` 可来自 env `EID` 覆盖

环境变量：`DTN_GRAPH_MODE=1`、`BOOTSTRAP_URL`、`NODE_X`、`NODE_Y`、`EID`。

- [ ] **Step 1: Unit-test GraphService merge via public ingestSummary（可用内存）**

- [ ] **Step 2–4: TDD 实现最小 GraphService + config 字段**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add GraphService and graph-mode config"
```

---

### Task 4: join 与 graph HTTP

**Files:**
- Modify: `apps/relay/src/relay/relay.controller.ts`
- Modify: `apps/relay/src/peer/peer.service.ts`（`postJoin`、`postGraph`）
- Create: `apps/relay/src/graph/graph-http.test.ts` 或扩展现有测试（纯逻辑为主；HTTP 可用轻量 supertest 若项目已有，否则手工脚本放到 Task 8）

**Interfaces:**
- `POST /api/peer/join` body `{ nodeId, eid, port, x, y, peerUrl }` → `{ ok, localEid, summary }`
- `POST /api/peer/graph` body `GraphSummary` → `{ ok }`
- `GET /api/graph` → `GraphService.snapshot()`（控制台用）

Join 双方写入 direct peer + 默认 cyclic 接触（例如 period 30s、整段可开或 openDuration 大，便于演示扩散；写明参数）。

- [ ] **Step 1: 实现 controller + peer client**

- [ ] **Step 2: 手动 curl 两进程 join（记入报告）或自动化**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add peer join and contact-graph gossip endpoints"
```

---

### Task 5: 启动 bootstrap 与 gossip 节流

**Files:**
- Modify: `apps/relay/src/main.ts` 或 `GraphService.onModuleInit`
- Modify: `apps/relay/src/graph/graph.service.ts`

**Behavior:**
- 若 `BOOTSTRAP_URL` 设：启动后 `postJoin`；失败则 log 并保持单机岛（或非 0 退出——选 **log + 单机岛**，与规格「可退出或单机」一致，计划定为单机岛 + 错误日志）。
- 定时器（如 2s）：对每个 direct peer，若 `contacts.isOpenTo(peer)` 则 `postGraph(exportSummary())`，每 peer 节流 ≥2s。

- [ ] **Step 1: Implement**

- [ ] **Step 2: 两进程验证摘要出现听说边（第三节点 join 后）**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: bootstrap join on startup and throttle graph gossip"
```

---

### Task 6: BundleService 图模式选路

**Files:**
- Modify: `apps/relay/src/bundle/bundle.service.ts`
- Create: `apps/relay/src/graph/graph-forward.test.ts`（尽量纯：mock decide 或对 prepareForward 用测试用 GraphService）

**Behavior:**
- `graphMode` 时：`next = decide(dst).nextHop`；null 则 WAITING，事件 `ROUTE` msg=reason。
- 有 next：事件记录 culled/selected 短句；其余 custody/CBOR 不变。
- 转发失败：`markUnhealthy(next)`。
- 非 graphMode：现有 `nextHop` 表。

- [ ] **Step 1: Failing test — unknown dst coords → no FORWARDING**

- [ ] **Step 2: Implement**

- [ ] **Step 3: `npm run test:relay` PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: forward with local contact-graph next-hop decisions"
```

---

### Task 7: 控制台改版

**Files:**
- Modify: `apps/relay/src/console/console.page.ts`（大改连接页；概览；操作目的下拉；束页选路事件已有则展示；运维选路条）
- Modify: `apps/relay/src/relay/relay.controller.ts`、`contact`/`graph` 快照已由 `GET /api/graph` 提供

**UI requirements (spec):**
- 连接页主区域 SVG：按 x,y 布点；本机高亮；`direct` 实线，否则虚线；点击边填侧栏。
- 运维：输入/选择试算 dst 或跟随 `openBundleId`，调用 `GET /api/graph/route?dst=`（Task 4/6 增加只读试算接口）展示 culled / candidates / nextHop。
- 操作：`dst` `<select>` 填 `snapshot.nodes`。
- 概览：已知节点数、种子数、摘要最大年龄。

- [ ] **Step 1: Add `GET /api/graph/route?dst=` → `decide` JSON**

- [ ] **Step 2: Console HTML/CSS/JS**

- [ ] **Step 3: Browser or headless check — 连接页非两行表为主**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: show scalable contact graph and route compare in console"
```

---

### Task 8: 集群脚本、文档、live 冒烟

**Files:**
- Create: `apps/relay/scripts/join-cluster.sh`（或 `.mjs`）
- Modify: `README.md`、`docs/relay-daemon-design.md`
- Create: `apps/relay/src/live-graph-join.test.ts`（`DTN_LIVE_GRAPH=1`，默认 skip；起进程或假定外部已起）

**Script behavior:**
1. 起 node0：`DTN_GRAPH_MODE=1`，无 bootstrap，固定坐标。
2. 起 node1..9：`BOOTSTRAP_URL=http://127.0.0.1:<port0>`，不同坐标/端口。
3. 等待 gossip；从 node0 send 到 node9；轮询 inbox（超时可配置，默认 120s）。
4. 可选：kill 一个中间节点再测（文档说明拓扑需有替代方向）。

- [ ] **Step 1: Script + README**

- [ ] **Step 2: Run join-cluster once；记结果**

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add graph-mode join cluster script and live checks"
```

---

## Self-Review

1. **Spec coverage:** join、摘要、选路、失败 unhealthy、控制台五页变化、10 节点测试规模、旧 tri 兼容 → Tasks 1–8。  
2. **Placeholders:** 无 TBD。  
3. **Types:** `GraphSummary` / `RouteDecision` / `decideNextHop` 命名在任务间一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-01-contact-graph-join.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每任务新子代理 + 审查  

**2. Inline Execution** — 本会话连续执行  

Which approach?
