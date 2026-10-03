# 副本提升与载荷 SHA-256 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主保管 unhealthy 后，哈希校验通过的冷副本接管 custody 并继续转发；坏载荷记 CORRUPT 且不提升。

**Architecture:** `payload-hash.ts` 只算/比对 SHA-256。`replica-promote.ts` 只回答能不能提升。`BundleService` 在创建/ingest/开转时写或核哈希，在 `planTick` 里用 `listBundleIds()` 扫副本（副本没有 custody，不能只扫 `listPendingBundleIds`）。探测只用 `graph.listUnhealthy()`，不加心跳。

**Tech Stack:** Node ≥18 `crypto.createHash('sha256')`，Nest `BundleService`，LevelDB `listBundleIds`（已有），`node:test` + `tsx`。

## Global Constraints

- 哈希：UTF-8 载荷的 SHA-256 **hex**；字段名 `payloadSha256`；不用 MD5、不上 BPSec BIB
- 无 `payloadSha256` 的旧束：不校验、**不**提升
- `DTN_REPLICA_PROMOTE` 默认开；仅 `0`／`false`／`no` 关闭提升；关提升时哈希仍写入并校验
- 提升条件：`replicaRole==='replica'` 且 `replicaOf` 在 `graph.listUnhealthy()`；关窗 ≠ unhealthy
- 不租约、不选举、不向源「重要」；两副本可同时提升；目的地靠现有 bundle id `DUPLICATE`
- 不改 CGR／`DTN_REPLICA_N`／`DTN_REPLICA_STRATEGY`
- Spec: `docs/superpowers/specs/2026-10-03-replica-promote-hash-design.md`
- 未获用户明确要求时不要 `git commit`／`git push`

## File map

| Path | Responsibility |
|------|----------------|
| `apps/relay/src/bundle/payload-hash.ts` | `payloadSha256` / `payloadHashOk` |
| `apps/relay/src/bundle/payload-hash.test.ts` | 原文通过、改一字失败、缺字段不校验 |
| `apps/relay/src/bundle/replica-promote.ts` | `replicaPromoteEnabled` / `canPromoteReplica` |
| `apps/relay/src/bundle/replica-promote.test.ts` | 提升谓词全部分支 |
| `apps/relay/src/bundle/bundle.types.ts` | `payloadSha256`；`status.replica.promote` |
| `apps/relay/src/bundle/bundle.service.ts` | 写哈希、CORRUPT、planTick 提升 |
| `apps/relay/src/bundle/replica-forward.test.ts` | 提升／CORRUPT 集成 |
| `docs/interop.md` `README.md` `docs/todo.md` `docs/relay-daemon-design.md` | 配置说明 |
| `apps/relay/src/console/console.page.ts` | 束详情显示哈希前 12 位 |

---

### Task 1: payload-hash

**Files:**
- Create: `apps/relay/src/bundle/payload-hash.ts`
- Create: `apps/relay/src/bundle/payload-hash.test.ts`

**Interfaces:**
- Consumes: Node `crypto`
- Produces:
  - `payloadSha256(payload: string): string`
  - `payloadHashOk(payload: string, expected?: string): boolean` — `expected` 为空／undefined 时返回 `true`（旧束不校验）

- [ ] **Step 1: Write the failing test**

Create `apps/relay/src/bundle/payload-hash.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payloadHashOk, payloadSha256 } from './payload-hash';

test('sha256 of hi matches known hex', () => {
  assert.equal(
    payloadSha256('hi'),
    '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
  );
});

test('ok when expected matches; fail when one char changes', () => {
  const hex = payloadSha256('hi');
  assert.equal(payloadHashOk('hi', hex), true);
  assert.equal(payloadHashOk('hj', hex), false);
});

test('missing expected hash is treated as ok (legacy)', () => {
  assert.equal(payloadHashOk('hi'), true);
  assert.equal(payloadHashOk('hi', ''), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/bundle/payload-hash.test.ts`

Expected: FAIL `Cannot find module './payload-hash'` 或 `payloadSha256 is not a function`

- [ ] **Step 3: Write minimal implementation**

Create `apps/relay/src/bundle/payload-hash.ts`:

```typescript
import { createHash } from 'node:crypto';

export function payloadSha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function payloadHashOk(payload: string, expected?: string): boolean {
  if (expected == null || expected === '') return true;
  return payloadSha256(payload) === expected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @yinghuo/relay -- src/bundle/payload-hash.test.ts`

Expected: 上述 3 个测试 PASS（套件里其它测试也应绿）

- [ ] **Step 5: Commit**（仅当用户要求提交时）

```bash
git add apps/relay/src/bundle/payload-hash.ts apps/relay/src/bundle/payload-hash.test.ts
git commit -m "$(cat <<'EOF'
feat: SHA-256 payload hash helpers for replica integrity

EOF
)"
```

---

### Task 2: canPromoteReplica 纯函数

**Files:**
- Create: `apps/relay/src/bundle/replica-promote.ts`
- Create: `apps/relay/src/bundle/replica-promote.test.ts`

**Interfaces:**
- Consumes: `payloadHashOk` from `payload-hash.ts`
- Produces:
  - `replicaPromoteEnabled(env?: Record<string, string | undefined>): boolean` — 默认 `true`；`0`／`false`／`no`（大小写不敏感）为 `false`
  - `PromoteSkip = 'not-replica' | 'promote-off' | 'primary-alive' | 'no-hash' | 'corrupt' | 'missing-custodian'`
  - `canPromoteReplica(input: { replicaRole?: 'primary' | 'replica'; replicaOf?: string; payload: string; payloadSha256?: string; unhealthyIds: Iterable<string>; promoteEnabled: boolean }): { ok: true } | { ok: false; reason: PromoteSkip }`

- [ ] **Step 1: Write the failing test**

Create `apps/relay/src/bundle/replica-promote.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payloadSha256 } from './payload-hash';
import { canPromoteReplica, replicaPromoteEnabled } from './replica-promote';

const hex = payloadSha256('hi');
const base = {
  replicaRole: 'replica' as const,
  replicaOf: 'Earth',
  payload: 'hi',
  payloadSha256: hex,
  unhealthyIds: ['Earth'],
  promoteEnabled: true,
};

test('promote env default on; 0/false/no off', () => {
  assert.equal(replicaPromoteEnabled({}), true);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: '0' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: 'false' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: 'NO' }), false);
  assert.equal(replicaPromoteEnabled({ DTN_REPLICA_PROMOTE: '1' }), true);
});

test('promotes replica when custodian unhealthy and hash ok', () => {
  assert.deepEqual(canPromoteReplica(base), { ok: true });
});

test('skips when promote disabled', () => {
  assert.deepEqual(canPromoteReplica({ ...base, promoteEnabled: false }), {
    ok: false,
    reason: 'promote-off',
  });
});

test('skips when not a replica', () => {
  assert.deepEqual(canPromoteReplica({ ...base, replicaRole: 'primary' }), {
    ok: false,
    reason: 'not-replica',
  });
});

test('skips when primary is not unhealthy (contact closed is not enough)', () => {
  assert.deepEqual(canPromoteReplica({ ...base, unhealthyIds: [] }), {
    ok: false,
    reason: 'primary-alive',
  });
});

test('skips legacy bundles without hash', () => {
  assert.deepEqual(
    canPromoteReplica({ ...base, payloadSha256: undefined }),
    { ok: false, reason: 'no-hash' },
  );
});

test('skips corrupt payload', () => {
  assert.deepEqual(canPromoteReplica({ ...base, payload: 'hj' }), {
    ok: false,
    reason: 'corrupt',
  });
});

test('skips missing replicaOf', () => {
  assert.deepEqual(canPromoteReplica({ ...base, replicaOf: undefined }), {
    ok: false,
    reason: 'missing-custodian',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/bundle/replica-promote.test.ts`

Expected: FAIL 找不到 `./replica-promote`

- [ ] **Step 3: Write minimal implementation**

Create `apps/relay/src/bundle/replica-promote.ts`:

```typescript
import { payloadHashOk } from './payload-hash';

export function replicaPromoteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.DTN_REPLICA_PROMOTE ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

export type PromoteSkip =
  | 'not-replica'
  | 'promote-off'
  | 'primary-alive'
  | 'no-hash'
  | 'corrupt'
  | 'missing-custodian';

export function canPromoteReplica(input: {
  replicaRole?: 'primary' | 'replica';
  replicaOf?: string;
  payload: string;
  payloadSha256?: string;
  unhealthyIds: Iterable<string>;
  promoteEnabled: boolean;
}): { ok: true } | { ok: false; reason: PromoteSkip } {
  if (!input.promoteEnabled) return { ok: false, reason: 'promote-off' };
  if (input.replicaRole !== 'replica') return { ok: false, reason: 'not-replica' };
  if (!input.replicaOf) return { ok: false, reason: 'missing-custodian' };
  const down = new Set(input.unhealthyIds);
  if (!down.has(input.replicaOf)) return { ok: false, reason: 'primary-alive' };
  if (!input.payloadSha256) return { ok: false, reason: 'no-hash' };
  if (!payloadHashOk(input.payload, input.payloadSha256)) {
    return { ok: false, reason: 'corrupt' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @yinghuo/relay -- src/bundle/replica-promote.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求提交时）

```bash
git add apps/relay/src/bundle/replica-promote.ts apps/relay/src/bundle/replica-promote.test.ts
git commit -m "$(cat <<'EOF'
feat: replica promote predicate from unhealthy + sha256

EOF
)"
```

---

### Task 3: 创建／ingest／开转写入并核对哈希

**Files:**
- Modify: `apps/relay/src/bundle/bundle.types.ts` — `RelayBundle` 增加可选 `payloadSha256?: string`
- Modify: `apps/relay/src/bundle/bundle.service.ts` — `fromTracked` 保留哈希；`stageSend` 写入；replica ingest 核对；`prepareForward` 开转前核对
- Modify: `apps/relay/src/bundle/replica-forward.test.ts` — ingest 坏哈希 → `CORRUPT`、无 custody

**Interfaces:**
- Consumes: `payloadSha256`, `payloadHashOk`
- Produces: 存储的 primary／replica 带同一 `payloadSha256`；坏哈希 replica 仍落盘但 `event: 'CORRUPT'`、`accepted: true`（运维能看见）、不 custody；`prepareForward` 遇坏哈希写 `CORRUPT` 事件并返回 `null`（旧束无字段则跳过校验）

- [ ] **Step 1: Write the failing ingest test**

In `apps/relay/src/bundle/replica-forward.test.ts` append:

```typescript
test('replica ingest with bad sha256 records CORRUPT and skips custody', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  const incoming: RelayBundle = {
    id: 'b-bad',
    src: 'Earth',
    dst: 'Mars',
    payload: 'hj',
    payloadSha256: payloadSha256('hi'),
    createdAt: Date.now(),
    ttlMs: 120_000,
    hops: [],
    delivered: false,
  };
  const result = await bundles.ingestFromPeer(incoming, 'Earth', true);
  assert.equal(result.event, 'CORRUPT');
  assert.equal(store.custody.size, 0);
  const stored = await store.getBundle('b-bad');
  assert.equal(stored?.replicaRole, 'replica');
  assert.equal(
    (stored?.events ?? []).some((e) => e.kind === 'CORRUPT'),
    true,
  );
});
```

Add import: `import { payloadSha256 } from './payload-hash';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/bundle/replica-forward.test.ts`

Expected: FAIL `event` 仍是 `REPLICA_STORE`

- [ ] **Step 3: Wire hash through types + BundleService**

1. `RelayBundle` 增加 `payloadSha256?: string`。

2. `fromTracked` 增加：

```typescript
...(orig?.payloadSha256 ? { payloadSha256: orig.payloadSha256 } : {}),
```

3. `stageSend` 在 `bundle.replicaRole = 'primary'` 之后：

```typescript
bundle.payloadSha256 = payloadSha256(payload);
```

4. replica 分支，在组 `stored` 之前：

```typescript
if (bundle.payloadSha256 && !payloadHashOk(bundle.payload, bundle.payloadSha256)) {
  const stored: RelayBundle = {
    ...bundle,
    replicaRole: 'replica',
    replicaOf: from,
    custodian: from,
    replicas: [],
    delivered: false,
    state: 'WAITING',
    events: [
      ...(bundle.events ?? []),
      { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
    ],
  };
  await this.store.putBundle(stored);
  this.pushEvent('CORRUPT', `${stored.id} replica payload mismatch`);
  return {
    accepted: true,
    delivered: false,
    event: 'CORRUPT',
    msg: `${stored.id} corrupt replica`,
  };
}
```

5. `prepareForward` 在读到 `bundle` 且未过期之后：

```typescript
if (bundle.payloadSha256 && !payloadHashOk(bundle.payload, bundle.payloadSha256)) {
  if (!(bundle.events ?? []).some((e) => e.kind === 'CORRUPT')) {
    const now = Date.now();
    await this.store.putBundle({
      ...bundle,
      events: [
        ...(bundle.events ?? []),
        { t: now, node: this.cfg.nodeId, kind: 'CORRUPT', msg: 'payload sha256 mismatch' },
      ],
    });
    this.pushEvent('CORRUPT', `${bundleId} payload mismatch`);
  }
  return null;
}
```

Imports: `payloadHashOk, payloadSha256` from `./payload-hash`。

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay`

Expected: PASS，含新 CORRUPT 用例；send 路径会自动带上哈希

- [ ] **Step 5: Commit**（仅当用户要求提交时）

```bash
git add apps/relay/src/bundle/bundle.types.ts apps/relay/src/bundle/bundle.service.ts apps/relay/src/bundle/replica-forward.test.ts
git commit -m "$(cat <<'EOF'
feat: persist and verify payload SHA-256 on send and ingest

EOF
)"
```

---

### Task 4: planTick 提升副本

**Files:**
- Modify: `apps/relay/src/bundle/bundle.service.ts` — `planTick` 先 `promoteReplicas()`
- Modify: `apps/relay/src/bundle/replica-forward.test.ts` — MemoryStore 增加 `listBundleIds`；提升成功／关 promote／unhealthy 缺失

**Interfaces:**
- Consumes: `canPromoteReplica`, `replicaPromoteEnabled`, `GraphService.listUnhealthy()`, `LevelStore.listBundleIds()`（已存在）
- Produces: 提升后 `replicaRole='primary'`、`custodian=本节点`、`putCustody`、事件 `PROMOTE`，随后走已有 `prepareForward`（同一 tick 后半段扫 custody）

- [ ] **Step 1: Extend MemoryStore + write failing promote tests**

In `replica-forward.test.ts` `MemoryStore` 增加：

```typescript
async listBundleIds(): Promise<string[]> {
  return [...this.bundles.keys()];
}
```

Append tests（`planTick` 与 encode 测试相同，经 `as unknown` 调用）：

```typescript
test('promotes replica when replicaOf is unhealthy and hash ok', async () => {
  loadBpCodec();
  const cfg = runtime();
  cfg.nodeId = 'Spare';
  cfg.eid = 'ipn:2.3';
  cfg.role = 'orbiter';
  const store = new MemoryStore();
  const graph = new GraphService(cfg);
  graph.markUnhealthy('Earth');
  const contacts = new ContactService(cfg, graph);
  const peer = new PeerService(cfg, graph);
  peer.forwardTo = async (_url, bundle) => ({ ok: true, wireBase64: bundle.wire });
  const bundles = new BundleService(
    cfg,
    store as unknown as LevelStore,
    contacts,
    peer,
    graph,
  );
  const hex = payloadSha256('hi');
  await bundles.ingestFromPeer(
    {
      id: 'b-prom',
      src: 'Earth',
      dst: 'Mars',
      payload: 'hi',
      payloadSha256: hex,
      createdAt: Date.now(),
      ttlMs: 120_000,
      hops: [],
      delivered: false,
    },
    'Earth',
    true,
  );
  const svc = bundles as unknown as { planTick(): Promise<{ forwards: unknown[] }> };
  await svc.planTick();
  const stored = await store.getBundle('b-prom');
  assert.equal(stored?.replicaRole, 'primary');
  assert.equal(stored?.custodian, 'Spare');
  assert.ok(store.custody.has('b-prom'));
  assert.equal((stored?.events ?? []).some((e) => e.kind === 'PROMOTE'), true);
});

test('does not promote when DTN_REPLICA_PROMOTE is 0', async () => {
  const prev = process.env.DTN_REPLICA_PROMOTE;
  process.env.DTN_REPLICA_PROMOTE = '0';
  try {
    loadBpCodec();
    const cfg = runtime();
    cfg.nodeId = 'Spare';
    cfg.eid = 'ipn:2.3';
    const store = new MemoryStore();
    const graph = new GraphService(cfg);
    graph.markUnhealthy('Earth');
    const contacts = new ContactService(cfg, graph);
    const peer = new PeerService(cfg, graph);
    const bundles = new BundleService(
      cfg,
      store as unknown as LevelStore,
      contacts,
      peer,
      graph,
    );
    await bundles.ingestFromPeer(
      {
        id: 'b-off',
        src: 'Earth',
        dst: 'Mars',
        payload: 'hi',
        payloadSha256: payloadSha256('hi'),
        createdAt: Date.now(),
        ttlMs: 120_000,
        hops: [],
        delivered: false,
      },
      'Earth',
      true,
    );
    const svc = bundles as unknown as { planTick(): Promise<unknown> };
    await svc.planTick();
    const stored = await store.getBundle('b-off');
    assert.equal(stored?.replicaRole, 'replica');
    assert.equal(store.custody.size, 0);
  } finally {
    if (prev === undefined) delete process.env.DTN_REPLICA_PROMOTE;
    else process.env.DTN_REPLICA_PROMOTE = prev;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @yinghuo/relay -- src/bundle/replica-forward.test.ts`

Expected: FAIL `replicaRole` 仍是 `replica`（planTick 不扫无 custody 的束）

- [ ] **Step 3: Implement promoteReplicas in BundleService**

Import `canPromoteReplica, replicaPromoteEnabled` from `./replica-promote`。

```typescript
private async promoteReplicas(): Promise<void> {
  const promoteEnabled = replicaPromoteEnabled();
  const unhealthyIds = this.graph?.listUnhealthy() ?? [];
  const ids = await this.store.listBundleIds();
  for (const id of ids) {
    const bundle = await this.store.getBundle(id);
    if (!bundle) continue;
    const decision = canPromoteReplica({
      replicaRole: bundle.replicaRole,
      replicaOf: bundle.replicaOf,
      payload: bundle.payload,
      payloadSha256: bundle.payloadSha256,
      unhealthyIds,
      promoteEnabled,
    });
    if (!decision.ok) continue;
    const now = Date.now();
    const promoted: RelayBundle = {
      ...bundle,
      replicaRole: 'primary',
      custodian: this.cfg.nodeId,
      events: [
        ...(bundle.events ?? []),
        { t: now, node: this.cfg.nodeId, kind: 'PROMOTE', msg: `custody from ${bundle.replicaOf}` },
      ],
    };
    await this.store.putBundle(promoted);
    await this.store.putCustody({
      bundleId: promoted.id,
      waitingAck: false,
      from: null,
      heldAt: now,
    });
    this.rememberBundle(promoted.id);
    this.pushEvent('PROMOTE', `${promoted.id} was ${bundle.replicaOf}`);
  }
}
```

`planTick` 在 `listPendingBundleIds` **之前**：

```typescript
await this.promoteReplicas();
const ids = await this.store.listPendingBundleIds();
```

`canPromoteReplica` 返回 `corrupt` 时 ingest 已记过 CORRUPT；tick 里 `continue` 即可，不必再写一遍。

- [ ] **Step 4: Run full relay tests**

Run: `npm test -w @yinghuo/relay`

Expected: 全部 PASS（含提升与 `DTN_REPLICA_PROMOTE=0`）

- [ ] **Step 5: Commit**（仅当用户要求提交时）

```bash
git add apps/relay/src/bundle/bundle.service.ts apps/relay/src/bundle/replica-forward.test.ts
git commit -m "$(cat <<'EOF'
feat: promote hashed replicas when primary is unhealthy

EOF
)"
```

---

### Task 5: status.promote + 文档 + 控制台

**Files:**
- Modify: `apps/relay/src/bundle/bundle.types.ts` — `replica: { n; strategy; promote: boolean }`
- Modify: `apps/relay/src/bundle/bundle.service.ts` — `status()` 填 `promote: replicaPromoteEnabled()`
- Modify: `docs/interop.md` 冷副本节：提升 + SHA-256
- Modify: `README.md` 环境变量表：`DTN_REPLICA_PROMOTE`
- Modify: `docs/todo.md`：勾掉「副本提升」开放项，注明哈希已做
- Modify: `docs/relay-daemon-design.md` 10b 节
- Modify: `apps/relay/src/console/console.page.ts` — 束详情若有 `payloadSha256` 显示前 12 位

**Interfaces:**
- Consumes: `replicaPromoteEnabled`, `replicaCount`, `replicaStrategy`
- Produces: `GET /api/status` → `replica.promote`

- [ ] **Step 1: Types + status field**

```typescript
replica: {
  n: number;
  strategy: 'nearest' | 'quality' | 'far';
  promote: boolean;
};
```

```typescript
replica: {
  n: replicaCount(),
  strategy: replicaStrategy(),
  promote: replicaPromoteEnabled(),
},
```

- [ ] **Step 2: Docs** — interop 冷副本节追加：

```markdown
`DTN_REPLICA_PROMOTE` 默认开：当 `replicaOf` 在 unhealthy 名单且 `payloadSha256` 核对通过时，副本接管 custody（事件 `PROMOTE`）。哈希对不上记 `CORRUPT`，不提升。旧束无哈希字段不提升。`0` 关闭提升。
```

README 表增加一行 `DTN_REPLICA_PROMOTE`。todo 中「提升／状态同步」改为提升已做、状态同步仍开放。

- [ ] **Step 3: Console** — `bundleOpsLines` 在 replica 行后：

```javascript
if (bundle.payloadSha256) {
  lines.push('sha256: ' + String(bundle.payloadSha256).slice(0, 12));
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @yinghuo/relay`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求提交时）

```bash
git add apps/relay/src/bundle/bundle.types.ts apps/relay/src/bundle/bundle.service.ts apps/relay/src/console/console.page.ts README.md docs/interop.md docs/todo.md docs/relay-daemon-design.md
git commit -m "$(cat <<'EOF'
docs: replica promote flag and payload sha256

EOF
)"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| 创建写 SHA-256 | 3 |
| ingest／开转核对；CORRUPT | 3 |
| unhealthy + 好哈希 → 提升 + custody + 转发入口 | 4 |
| 坏哈希不提升 | 2 + 3（ingest）+ 4（tick skip） |
| 关窗 ≠ 提升 | 2 `primary-alive` |
| `DTN_REPLICA_PROMOTE=0` | 2 + 4 |
| 无哈希旧束不提升 | 2 |
| status.replica.promote | 5 |
| 不心跳、不租约、不改 CGR | 约束；4 只用 `listUnhealthy` |
| 两副本同时提升 / DUPLICATE | 非目标，无新代码 |
