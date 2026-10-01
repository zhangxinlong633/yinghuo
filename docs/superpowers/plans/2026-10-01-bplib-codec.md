# bplib 编解码与三层视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 节点之间用 bplib 编出的 BPv7 CBOR 传输；业务、网络、运维三套字段分开；保管与接触窗口仍由现有 Nest 守护进程负责。

**Architecture:** 薄 C 包装调用 `BPLib_CBOR_EncodeBundle` / `BPLib_CBOR_DecodeBundle`，导出三个 C ABI 函数；Node 用 `koffi` 加载共享库。业务 API 仍用节点名与载荷；出站编码、入站解码发生在 peer 边界。运维摘要（状态、时间线、主块字段、原始束长度）与 CBOR 分列存放。

**Tech Stack:** NestJS relay、LevelDB、`koffi`、NASA bplib（CBOR 模块）、QCBOR、CMake、Node `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-10-01-bplib-codec-design.md`

## Global Constraints

- bplib 只做编解码；不把转发、LevelDB、托管状态机交给 bplib。
- 共享库无法加载时进程启动失败并退出；默认不静默退回 JSON。
- `DTN_ALLOW_JSON_INGEST=1` 时 ingest 可额外接受旧 JSON；编码出口仍是 BPv7。
- 接触计划每个节点有 `eid`；缺省 Earth=`ipn:1.1`，Relay=`ipn:2.1`，Mars=`ipn:3.1`。
- 线上 ingest：`Content-Type: application/cbor`，body 为原始 CBOR 字节；`from` 用 HTTP 头 `x-dtn-from`。
- 业务 `POST /api/send` 响应只有 `{ ok, id, src, dst, payload, ttlMs }`。
- 不修改 `k8s/`；不做 LTP/TCPCL、接触图路由、BPSec、分片。
- 本机为 macOS 时优先编出 `.dylib`；若完整 OSAL 构建失败，允许只链入 bplib 的 `ci/cbor` 源码与 QCBOR，并用最小 `BPLib_Instance_t` 桩满足 Decode——仍使用 NASA bplib CBOR 源，不得手写另一套主块布局冒充 bplib。

## File Structure

| Path | Responsibility |
|------|----------------|
| `native/bp-codec/include/dtn_bp_codec.h` | 三个导出函数的 C ABI |
| `native/bp-codec/src/dtn_bp_codec.c` | 组 `BPLib_Bundle_t`、调用 bplib CBOR、释放缓冲 |
| `native/bp-codec/CMakeLists.txt` | 编出 `libdtn_bp_codec`（`.dylib` / `.so`） |
| `native/bp-codec/scripts/fetch-deps.sh` | 拉取固定版本的 bplib 与 QCBOR 到 `native/third_party/` |
| `native/third_party/` | gitignored 依赖树（或 submodule）；不提交大体积源码除非团队另定 |
| `apps/relay/src/bp/bp-codec.ts` | `koffi` 绑定；加载失败抛错 |
| `apps/relay/src/bp/bp-codec.test.ts` | 编解码往返与 inspect |
| `apps/relay/src/bp/eid.ts` | 节点名 ↔ EID（读计划） |
| `apps/relay/src/config.ts` | 加载 `eid` 进运行时配置 |
| `apps/relay/contact-plan.tri.json` | 写入三个 `eid` |
| `apps/relay/src/peer/peer.service.ts` | 出站发 CBOR；带 `x-dtn-from` |
| `apps/relay/src/relay/relay.controller.ts` | ingest 读 CBOR；send 瘦响应 |
| `apps/relay/src/bundle/bundle.types.ts` | 可选 `wire` / 主块摘要字段 |
| `apps/relay/src/bundle/bundle.service.ts` | 转发前编码、入库保留 wire、详情带 inspect |
| `apps/relay/src/console/console.page.ts` | 操作 / 连接 / 报文三层字段 |
| `apps/relay/package.json` | 依赖 `koffi`；脚本 `native:build` |
| `README.md` / `docs/relay-daemon-design.md` | 构建共享库与三层说明 |

`.gitignore` 增加 `native/third_party/` 与 `native/bp-codec/build/`（若尚未忽略）。

---

### Task 1: 接触计划 EID 与运行时映射

**Files:**
- Modify: `apps/relay/contact-plan.tri.json`
- Modify: `apps/relay/src/bundle/bundle.types.ts`
- Modify: `apps/relay/src/config.ts`
- Create: `apps/relay/src/bp/eid.ts`
- Create: `apps/relay/src/bp/eid.test.ts`

**Interfaces:**
- Consumes: `DualNodeConfig` from `bundle.types.ts`
- Produces:
  - `DualNodeConfig.eid?: string`
  - `RelayRuntimeConfig.eid: string`
  - `RelayRuntimeConfig.eidByNode: Record<string, string>`
  - `eidForNode(cfg: RelayRuntimeConfig, nodeName: string): string`
  - `nodeForEid(cfg: RelayRuntimeConfig, eid: string): string | undefined`
  - Default map when `eid` omitted: Earth→`ipn:1.1`, Relay→`ipn:2.1`, Mars→`ipn:3.1`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { eidForNode, nodeForEid } from './eid';
import type { RelayRuntimeConfig } from '../config';

function cfg(partial: Partial<RelayRuntimeConfig> & Pick<RelayRuntimeConfig, 'eidByNode' | 'nodeId' | 'eid'>): RelayRuntimeConfig {
  return {
    port: 3101,
    peerUrl: '',
    peers: {},
    role: 'endpoint',
    nextHop: {},
    dataDir: '',
    plan: { nodes: [], contacts: [] },
    planPath: '',
    startedAt: 0,
    ...partial,
  };
}

test('maps node names to plan EIDs', () => {
  const c = cfg({
    nodeId: 'Earth',
    eid: 'ipn:1.1',
    eidByNode: { Earth: 'ipn:1.1', Relay: 'ipn:2.1', Mars: 'ipn:3.1' },
  });
  assert.equal(eidForNode(c, 'Mars'), 'ipn:3.1');
  assert.equal(nodeForEid(c, 'ipn:2.1'), 'Relay');
  assert.equal(nodeForEid(c, 'ipn:9.9'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @dtn-demo/relay -- src/bp/eid.test.ts`  
Expected: FAIL（模块或导不存在）

- [ ] **Step 3: Implement mapping + plan fields**

在 `contact-plan.tri.json` 每个 node 增加 `"eid": "ipn:N.1"`。  
在 `DualNodeConfig` 增加可选 `eid?: string`。  
`loadRelayConfig` 构建 `eidByNode`：优先读计划；缺省用上表。本节点 `cfg.eid = eidByNode[nodeId]`，缺失则抛错。  
实现 `eid.ts` 中的两个查找函数。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @dtn-demo/relay -- src/bp/eid.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/relay/contact-plan.tri.json apps/relay/src/bundle/bundle.types.ts apps/relay/src/config.ts apps/relay/src/bp/eid.ts apps/relay/src/bp/eid.test.ts
git commit -m "$(cat <<'EOF'
feat: map contact-plan nodes to configurable EIDs

EOF
)"
```

---

### Task 2: 原生 `libdtn_bp_codec`（bplib CBOR）

**Files:**
- Create: `native/bp-codec/include/dtn_bp_codec.h`
- Create: `native/bp-codec/src/dtn_bp_codec.c`
- Create: `native/bp-codec/CMakeLists.txt`
- Create: `native/bp-codec/scripts/fetch-deps.sh`
- Create: `native/bp-codec/src/dtn_bp_codec_smoke.c`（可选小可执行文件）
- Modify: `.gitignore`

**Interfaces:**
- Produces C ABI（`extern "C"`，调用方释放 `out_buf` 用 `dtn_bp_free`）：

```c
typedef struct {
  char *src_eid;
  char *dst_eid;
  uint8_t *payload;
  size_t payload_len;
  int64_t created_at_ms;
  int64_t ttl_ms;
} dtn_bp_decoded_t;

typedef struct {
  int version;
  char *src_eid;
  char *dst_eid;
  int64_t lifetime_ms;
  size_t byte_length;
  char hex32[65]; /* first 32 bytes as hex + NUL; shorter bundles pad unused with shorter string */
} dtn_bp_inspect_t;

int dtn_bp_encode(
  const char *src_eid,
  const char *dst_eid,
  const uint8_t *payload,
  size_t payload_len,
  int64_t created_at_ms,
  int64_t ttl_ms,
  uint8_t **out_buf,
  size_t *out_len
); /* 0 = ok */

int dtn_bp_decode(const uint8_t *buf, size_t len, dtn_bp_decoded_t *out); /* 0 = ok */
int dtn_bp_inspect(const uint8_t *buf, size_t len, dtn_bp_inspect_t *out); /* 0 = ok */
void dtn_bp_decoded_free(dtn_bp_decoded_t *v);
void dtn_bp_inspect_free(dtn_bp_inspect_t *v);
void dtn_bp_free(void *p);
```

- Implementation MUST call `BPLib_CBOR_EncodeBundle` / `BPLib_CBOR_DecodeBundle` from bplib `ci/cbor`（见 Global Constraints 中的 Darwin 回退）。

- [ ] **Step 1: Add fetch + CMake skeleton**

`fetch-deps.sh`：若目录不存在则 clone  
- QCBOR tag `v1.5.1` → `native/third_party/QCBOR`  
- bplib `main`（记录 commit hash 到 `native/bp-codec/BPLIB_COMMIT.txt`）→ `native/third_party/bplib`

`CMakeLists.txt`：生成 `dtn_bp_codec` SHARED，包含包装源与 bplib CBOR 源（至少 `bplib_cbor_encode_*.c`、`bplib_cbor_decode_*.c` 及它们编译所需文件），链接 QCBOR。输出到 `native/bp-codec/build/`。

`.gitignore`：

```
native/third_party/
native/bp-codec/build/
```

- [ ] **Step 2: Implement encode/decode/inspect wrapping bplib**

在 `dtn_bp_codec.c`：  
1. 将 `src_eid` / `dst_eid` 写入 `BPLib_Bundle_t` 主块字段（按 bplib 头文件中的 EID 类型 API）。  
2. 载荷写入 payload block。  
3. `created_at_ms` / `ttl_ms` 换成 DTN 时间与 lifetime（毫秒→秒按 bplib 约定，并在注释写明换算）。  
4. `BPLib_CBOR_EncodeBundle` 写入堆缓冲并交给 `*out_buf`。  
5. Decode：`BPLib_CBOR_DecodeBundle`，再抽出 EID 与 payload。  
6. Inspect：decode 后填 `version`、EID、lifetime、`byte_length`、前 32 字节 hex。

若完整 OSAL 节点初始化在 macOS 失败：只编译 CBOR 模块 + 满足 `BPLib_CBOR_DecodeBundle` 签名所需的最小 `Inst` 桩，并在 `README` 片段注明「codec-only 链接」。

- [ ] **Step 3: Build the library**

Run:

```bash
cd native/bp-codec
./scripts/fetch-deps.sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Expected: `build/libdtn_bp_codec.dylib`（macOS）或 `build/libdtn_bp_codec.so`（Linux）存在。

- [ ] **Step 4: Smoke roundtrip in C（或下一步用 Node 测）**

若有 `dtn_bp_codec_smoke`：encode `"hello"` 再 decode，断言 payload 一致。  
Run: `./build/dtn_bp_codec_smoke`  
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add native/bp-codec .gitignore
git commit -m "$(cat <<'EOF'
feat: add bplib-backed BPv7 codec shared library

EOF
)"
```

不要提交 `native/third_party/` 体积，除非团队决定改用 submodule 并单独提交。

---

### Task 3: TypeScript `koffi` 绑定

**Files:**
- Modify: `apps/relay/package.json`（加依赖 `koffi`，脚本 `native:build`）
- Create: `apps/relay/src/bp/bp-codec.ts`
- Create: `apps/relay/src/bp/bp-codec.test.ts`
- Modify: root `package.json`（可选 `native:build` 转发）

**Interfaces:**
- Consumes: `libdtn_bp_codec` from `native/bp-codec/build/`
- Produces:

```ts
export type BpDecoded = {
  srcEid: string;
  dstEid: string;
  payload: Buffer;
  createdAtMs: number;
  ttlMs: number;
};

export type BpInspect = {
  version: number;
  srcEid: string;
  dstEid: string;
  lifetimeMs: number;
  byteLength: number;
  hex32: string;
};

export function loadBpCodec(libPath?: string): void; // throws if missing
export function encodeBundle(input: {
  srcEid: string;
  dstEid: string;
  payload: Buffer | string;
  createdAtMs: number;
  ttlMs: number;
}): Buffer;
export function decodeBundle(buf: Buffer): BpDecoded;
export function inspectBundle(buf: Buffer): BpInspect;
```

默认库路径：`path.resolve(monorepoRoot(), 'native/bp-codec/build', process.platform === 'darwin' ? 'libdtn_bp_codec.dylib' : 'libdtn_bp_codec.so')`。  
可用环境变量 `DTN_BP_CODEC_LIB` 覆盖。

- [ ] **Step 1: Install koffi and write failing test**

```bash
npm install koffi -w @dtn-demo/relay
```

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBpCodec, encodeBundle, decodeBundle, inspectBundle } from './bp-codec';

test('roundtrip payload through bplib codec', () => {
  loadBpCodec();
  const wire = encodeBundle({
    srcEid: 'ipn:1.1',
    dstEid: 'ipn:3.1',
    payload: 'tri-bp',
    createdAtMs: Date.now(),
    ttlMs: 120000,
  });
  assert.ok(wire.length > 0);
  const decoded = decodeBundle(wire);
  assert.equal(decoded.srcEid, 'ipn:1.1');
  assert.equal(decoded.dstEid, 'ipn:3.1');
  assert.equal(decoded.payload.toString('utf8'), 'tri-bp');
  const info = inspectBundle(wire);
  assert.equal(info.byteLength, wire.length);
  assert.equal(info.srcEid, 'ipn:1.1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @dtn-demo/relay -- src/bp/bp-codec.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement koffi bindings**

`loadBpCodec`：`koffi.load(libPath)`，声明上述 C 函数；把 C 字符串 / 缓冲拷进 JS；每次 encode/decode 后调用对应 `*_free`。  
未调用 `loadBpCodec` 或加载失败时，`encodeBundle` 抛明确错误。

在 `apps/relay/package.json`：

```json
"native:build": "npm run native:build --prefix ../../native/bp-codec || (cd ../../native/bp-codec && ./scripts/fetch-deps.sh && cmake -S . -B build && cmake --build build)"
```

（按实际路径写成可运行的一条命令；也可在 `native/bp-codec/package.json` 放 `"build"` 脚本。）

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run native:build -w @dtn-demo/relay
npm test -w @dtn-demo/relay -- src/bp/bp-codec.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/relay/package.json package-lock.json apps/relay/src/bp/bp-codec.ts apps/relay/src/bp/bp-codec.test.ts
git commit -m "$(cat <<'EOF'
feat: bind bplib codec from Node via koffi

EOF
)"
```

---

### Task 4: 启动时加载编解码库

**Files:**
- Modify: `apps/relay/src/main.ts`（或 `app.module.ts` / 新建 `BpCodecModule`）
- Modify: `apps/relay/src/relay/relay.module.ts`

**Interfaces:**
- Consumes: `loadBpCodec()` from Task 3
- Produces: Nest 启动前完成加载；失败则进程非 0 退出

- [ ] **Step 1: Call loadBpCodec before Nest listen**

在 `main.ts` bootstrap 最早处：

```ts
import { loadBpCodec } from './bp/bp-codec';

async function bootstrap() {
  loadBpCodec();
  // existing NestFactory.create...
}
```

- [ ] **Step 2: Manually verify failure mode**

Run: `DTN_BP_CODEC_LIB=/nonexistent.dylib npm run start:earth -w @dtn-demo/relay`  
Expected: 进程退出，日志含库路径错误；不监听 3101。

- [ ] **Step 3: Commit**

```bash
git add apps/relay/src/main.ts
git commit -m "$(cat <<'EOF'
feat: require bplib codec library at relay startup

EOF
)"
```

---

### Task 5: Peer 线上改为 CBOR

**Files:**
- Modify: `apps/relay/src/peer/peer.service.ts`
- Modify: `apps/relay/src/relay/relay.controller.ts`
- Modify: `apps/relay/src/bundle/bundle.service.ts`
- Create: `apps/relay/src/bp/wire.test.ts`（纯逻辑：从 decoded 组装业务字段的小函数，若抽得出）

**Interfaces:**
- Consumes: `encodeBundle` / `decodeBundle`；`eidForNode` / `nodeForEid`
- Produces:
  - `PeerService.forwardTo(url, bundle)` 发送 `Buffer` body，`content-type: application/cbor`，头 `x-dtn-from: <nodeId>`
  - `POST /api/peer/ingest` 读 raw body（Nest 需 `rawBody` 或 `req` 流）；解码后调用现有 `ingestFromPeer`
  - 解码失败 → HTTP 400，`{ accepted:false, event:'DECODE_ERROR', msg }`
  - `DTN_ALLOW_JSON_INGEST=1` 且 `content-type: application/json` 时走旧路径

- [ ] **Step 1: Write failing test for encode input shape（单元）**

若抽出 `toWireBundle(bundle, cfg) -> Buffer`：

```ts
test('toWireBundle uses plan EIDs', () => {
  loadBpCodec();
  const buf = toWireBundle(
    { id: 'x', src: 'Earth', dst: 'Mars', payload: 'p', createdAt: 1, ttlMs: 1000, hops: [], delivered: false },
    sampleCfg
  );
  const d = decodeBundle(buf);
  assert.equal(d.dstEid, 'ipn:3.1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @dtn-demo/relay -- src/bp/wire.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement wire helpers + peer/controller**

`forwardTo`：

```ts
const wire = encodeBundle({
  srcEid: eidForNode(this.cfg, bundle.src),
  dstEid: eidForNode(this.cfg, bundle.dst),
  payload: bundle.payload,
  createdAtMs: bundle.createdAt,
  ttlMs: bundle.ttlMs,
});
const res = await fetch(`${url}/api/peer/ingest`, {
  method: 'POST',
  headers: {
    'content-type': 'application/cbor',
    'x-dtn-from': this.cfg.nodeId,
  },
  body: wire,
  signal: AbortSignal.timeout(3000),
});
```

Controller ingest：区分 content-type；CBOR 路径 `decodeBundle` → 还原 `RelayBundle`（`src`/`dst` 用 `nodeForEid`，未知 EID 拒收）→ `ingestFromPeer`。  
保留接触窗口 503 逻辑。  
在 `bundle` 上保存 `wire?: Buffer` 或 base64 字符串字段供运维（Task 6 可细化类型）。

- [ ] **Step 4: Run unit tests**

Run: `npm run test:relay`  
Expected: 现有 9 个场景测试仍 PASS（它们不走 HTTP）；新 wire 测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/peer/peer.service.ts apps/relay/src/relay/relay.controller.ts apps/relay/src/bundle/bundle.service.ts apps/relay/src/bp/wire.test.ts
git commit -m "$(cat <<'EOF'
feat: exchange BPv7 CBOR on peer ingest

EOF
)"
```

---

### Task 6: 业务瘦响应与运维详情字段

**Files:**
- Modify: `apps/relay/src/relay/relay.controller.ts`（`send`、`bundle`、`inbox`/`recv` 形状）
- Modify: `apps/relay/src/bundle/bundle.types.ts`
- Modify: `apps/relay/src/bundle/bundle.service.ts`（`getBundle` 附带 inspect）
- Create: `apps/relay/src/bp/business-view.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/send` → `{ ok: true, id, src, dst, payload, ttlMs }`（失败仍 `{ ok:false, error }`）
  - inbox / recv message → `{ id, src, dst, payload, deliveredAt }`（可保留 id 供运维深链，但不含 EID/state）
  - `GET /api/bundles/:id` → 现有 bundle 字段 + `primary: BpInspect`（无整束 hex 时可只用 `hex32`）+ `wireLength`

- [ ] **Step 1: Write failing assertion on send response shape**

```ts
test('business send view omits network fields', () => {
  const view = toBusinessSendResponse(sampleBundle);
  assert.deepEqual(Object.keys(view).sort(), ['dst', 'id', 'ok', 'payload', 'src', 'ttlMs'].sort());
});
```

（`ok` 由 controller 包一层也可以：测试 `toBusinessSendFields(bundle)` 只返回五字段。）

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement view mappers + controller**

```ts
export function toBusinessSendFields(b: RelayBundle) {
  return { id: b.id, src: b.src, dst: b.dst, payload: b.payload, ttlMs: b.ttlMs };
}
```

`getBundle`：若有 `wire`，`inspectBundle(wire)` 填入返回；否则省略 `primary`。

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/relay/src/relay/relay.controller.ts apps/relay/src/bundle apps/relay/src/bp/business-view.test.ts
git commit -m "$(cat <<'EOF'
feat: split business send fields from ops bundle detail

EOF
)"
```

---

### Task 7: 控制台三层可见性

**Files:**
- Modify: `apps/relay/src/console/console.page.ts`
- Modify: `apps/relay/src/contact/contact.service.ts`（若 contacts API 需带本端/对端 EID；否则在 console 用 status + plan）

**Interfaces:**
- Consumes: `/api/status`、`/api/contacts`、`/api/bundles/:id`（含 `primary`）
- Produces UI rules from spec:
  - 操作：无 EID、无 hex、无状态机英文；收件箱四字段
  - 连接：展示 `cfg`/contacts 上的本节点 EID、对端 EID、注明 CBOR
  - 报文：时间线 + `primary`（version、EID、lifetime、byteLength、hex32）；运维文案「束」

- [ ] **Step 1: Extend contacts or status payload with EIDs**

`GET /api/contacts` 增加：

```ts
localEid: cfg.eid,
eidByNode: cfg.eidByNode,
wireFormat: 'application/cbor',
```

- [ ] **Step 2: Update console.page.ts**

- 操作页发送成功只显示业务 id / dst / payload。  
- 连接页 kv 增加本端 EID、对端 EID、`wireFormat`。  
- 报文详情：渲染 `primary`；标题 i18n `bundlesTitle` 中文改为「束」（英文 `Bundles` 可保留或改 `Bundles (ops)`）。  
- 确认操作页模板字符串中无 `ipn:` 与 `hex32` 绑定。

- [ ] **Step 3: Browser check**

启动三节点，打开 Earth `/`：  
- 操作页源码/DOM 不含 `ipn:1.1`  
- 连接页含 `ipn:1.1`  
- 发一条后报文页详情含 `byteLength` 与时间线  

- [ ] **Step 4: Commit**

```bash
git add apps/relay/src/console/console.page.ts apps/relay/src/relay/relay.controller.ts apps/relay/src/contact/contact.service.ts
git commit -m "$(cat <<'EOF'
feat: show business, network, and ops fields on separate console views

EOF
)"
```

---

### Task 8: 文档与手动三节点验收

**Files:**
- Modify: `README.md`
- Modify: `docs/relay-daemon-design.md`

- [ ] **Step 1: Document native build**

README 增加：

```bash
npm run native:build -w @dtn-demo/relay
npm run relay:earth   # 另两终端 relay / mars
```

说明：共享库路径、`DTN_BP_CODEC_LIB`、`DTN_ALLOW_JSON_INGEST`。

- [ ] **Step 2: Manual acceptance checklist（执行并勾选）**

- [ ] 计划含三个 EID；改 Mars EID 后编码目的跟着变（单测或临时改计划）  
- [ ] `curl -s -X POST localhost:3101/api/send -H 'content-type: application/json' -d '{"dst":"Mars","payload":"bp1"}'` 响应键只有业务字段  
- [ ] 窗口打开后对端 ingest 为 CBOR（可用临时日志或抓 `content-type`）  
- [ ] 坏字节 → 400  
- [ ] Mars inbox 无 EID 字段  
- [ ] `GET /api/bundles/:id` 含 primary  
- [ ] 三节点错开窗口场景仍可达  

- [ ] **Step 3: Commit**

```bash
git add README.md docs/relay-daemon-design.md
git commit -m "$(cat <<'EOF'
docs: describe bplib codec build and three-layer console

EOF
)"
```

---

## Self-Review

1. **Spec coverage:** EID 可配 → T1；bplib FFI 编解码 → T2–T3；启动失败 → T4；线上 CBOR + JSON 开关 → T5；业务瘦响应与运维 primary → T6；控制台三层 → T7；文档与验收 → T8。角色模型与「目的已投递」回执按规格排除。  
2. **Placeholders:** 无 TBD；Darwin 回退写明仍用 bplib CBOR 源。  
3. **Type consistency:** `eidForNode` / `encodeBundle` / `BpInspect` 命名在 T1–T6 一致；ingest 头 `x-dtn-from` 在 T5 固定。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-01-bplib-codec.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个任务派一个新子代理，任务间审查，迭代快  

**2. Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

Which approach?
