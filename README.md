# DTN 萤火束递网（LightLink）

> **暗空萤火，束递相连** · *LightLink in Dark Space*

| | |
|--|--|
| 中文代号 | **萤火** |
| 英文代号 | **LightLink** |
| 正式全称 | **DTN 萤火束递网** |
| English | **DTN LightLink Bundle Delivery Fabric** |
| 控制台 | **萤火控制台** / LightLink Console |

TypeScript monorepo：**常驻 NestJS relay daemon** 为主路径；本地 **CLI / SDK** 只连 `localhost`；**Next.js** 提供接触计划页与旧仿真可视化；**Kubernetes YAML** 示意日程感知调度（Future）。灵感来自 Bundle Protocol，**不是**完整 BP / ION。

萤火是名字，束递网是本体——节点像暗空里的萤火：微弱、间歇、偶尔相遇，却能把信息存下来、带出去、递下去。

约束见 [`AGENTS.md`](./AGENTS.md)。设计见 [`docs/relay-daemon-design.md`](./docs/relay-daemon-design.md)、[`docs/superpowers/specs/2026-10-01-dtn-three-node-design.md`](./docs/superpowers/specs/2026-10-01-dtn-three-node-design.md)、[`docs/superpowers/specs/2026-10-01-bplib-codec-design.md`](./docs/superpowers/specs/2026-10-01-bplib-codec-design.md)、[`docs/superpowers/specs/2026-10-01-contact-graph-join-design.md`](./docs/superpowers/specs/2026-10-01-contact-graph-join-design.md)。

## 特性一览

| 能力 | 说明 |
|------|------|
| **三节点 store-and-forward** | 默认 Earth → Relay → Mars；接触窗口错开，无 Earth↔Mars 直连；关窗保管、开窗转发 |
| **Bundle 状态机** | `WAITING` → `FORWARDING` → `ARRIVED` / `ACKED` / `EXPIRED`；逐跳 custody ACK；TTL 过期；同 id 去重；锁内不跨 peer HTTP |
| **BPv7 线上编解码** | NASA **bplib** + QCBOR，经 `koffi` FFI；节点间 `Content-Type: application/cbor`；库缺失则启动失败（不静默退回 JSON） |
| **业务 / 网络 / 运维分层** | 发送与收件箱只露节点名与载荷；连接页看 EID / 窗口；束详情看主块摘要与时间线 |
| **可配置 EID** | 计划或环境变量映射节点名 ↔ `ipn:…`；编解码前后做名字与 EID 互转 |
| **接触图模式** | `DTN_GRAPH_MODE=1`：引导加入、摘要 gossip、局部图选路（先裁更远邻居，再选等待+时延最小） |
| **动态加入集群** | `POST /api/peer/join` + `POST /api/peer/graph`；`join-cluster.sh` 可起 N 节点冒烟 |
| **萤火控制台** | 各节点 `/`：概览、存储、连接（坐标网络图 + 选路对照）、操作、束、日志；顶栏节点名 / 状态 / 居中文字菜单 |
| **CLI / SDK** | `status` / `send` / `recv` / `wait`；`@lightlink/sdk` 订阅投递 |
| **测试** | `npm run test:relay`（单元）；`DTN_LIVE_SMOKE=1` 三节点 live；`DTN_LIVE_GRAPH=1` 接触图 live |

## 仓库结构

```
萤火/
├── AGENTS.md
├── README.md
├── docs/relay-daemon-design.md
├── docs/superpowers/specs/      # 三节点 / bplib / 接触图设计
├── docs/superpowers/plans/      # 对应实现计划
├── docs/k8s-dtn-scheduling.md
├── k8s/
├── data/Earth|Relay|Mars/       # LevelDB×3（gitignore）
├── native/bp-codec/             # bplib 薄包装 + CMake（.dylib / .so）
├── native/third_party/          # QCBOR、bplib（脚本拉取）
├── packages/dtn-core/           # 旧离散仿真核心
├── packages/dtn-sdk/
├── packages/dtn-cli/
├── apps/relay/                  # NestJS relay（主路径）
├── apps/api/                    # 旧仿真 Nest API :3001
└── apps/web/                    # Next.js 接触计划 + 旧仿真 UI
```

## 快速开始（三节点 — 推荐）

```bash
cd /Users/bruce/git/space/lightlink
npm install

# 首次或升级后：编译 bplib BPv7 共享库（macOS .dylib / Linux .so）
npm run native:build -w @lightlink/relay

# 终端 1 — Earth relay :3101
npm run relay:earth

# 终端 2 — 中间 Relay :3103
npm run relay:relay

# 终端 3 — Mars relay :3102
npm run relay:mars

# 终端 4（可选）— CLI / 等待投递
npm run cli -- status
DTN_NODE=Earth npm run cli -- send Mars "Hello Mars"
DTN_NODE=Mars  npm run cli -- wait 60

# 可选：Next.js 接触计划页 :3000（需 web；三个 relay 已启动）
npm run web
# http://localhost:3000/
# 中继控制台：http://127.0.0.1:3101/ 、http://127.0.0.1:3103/ 、http://127.0.0.1:3102/
```

默认接触计划为 `apps/relay/contact-plan.tri.json`（30s 周期，**两段窗口错开**：Earth–Relay 在 `[0s,10s)` 打开，Relay–Mars 在 `[15s,25s)` 打开，任意时刻无 Earth↔Mars 直连）。

### 端口与路径

| 节点 | 端口 | 下一跳 / Peer | LevelDB |
|------|------|---------------|---------|
| Earth | 3101 | Relay `http://127.0.0.1:3103` | `data/Earth/{bundles,custody,index}/` |
| Relay | 3103 | Earth / Mars | `data/Relay/{bundles,custody,index}/` |
| Mars | 3102 | Relay `http://127.0.0.1:3103` | `data/Mars/{bundles,custody,index}/` |

关窗时发往下一跳的 bundle 会 **WAITING**（保管）；开窗后 **FORWARD → … → DELIVER**，Mars 侧 `recv` / `wait` 取走；Earth 可在控制台报文时间线看到 **ARRIVED** 确认。转发前先用 bplib **编码成 CBOR**，再进入 `FORWARDING`（编码失败不进入转发）。

环境变量：`NODE_ID`、`PORT`、`PEER_URL`、`DATA_DIR`、`CONTACT_PLAN`、`EID`；CLI 用 `DTN_RELAY_URL` 或 `DTN_NODE=Earth|Relay|Mars`。

### Bundle 生命周期

| 状态 | 含义 |
|------|------|
| `WAITING` | 关窗或尚无可用下一跳；LevelDB custody 持有 |
| `FORWARDING` | 已编码并正在向 peer ingest |
| `ARRIVED` | 目的端本地投递；上游可收到 ACK |
| `ACKED` | 保管释放确认 |
| `EXPIRED` | TTL 到期（含收件箱过期清理） |

时间线事件（STORED / FORWARD / RETRY / ARRIVED / ACKED / …）可在控制台「束」页或 `GET /api/bundles/:id` 查看。

### 接触图模式（动态加入）

`DTN_GRAPH_MODE=1` 时不使用计划里的静态 `nextHop`：

1. **引导岛**：第一台不设 `BOOTSTRAP_URL`。
2. **加入**：其余节点设 `BOOTSTRAP_URL`、本机 `PEER_URL`、`EID`、`NODE_X` / `NODE_Y`、独立 `PORT`；启动时 `POST /api/peer/join`。
3. **Gossip**：约每 2s 在打开的直连边上 `POST /api/peer/graph` 交换接触摘要（节点坐标、边、窗口、时延、hopCount）。
4. **选路**：只考虑直连且健康的邻居 → **裁掉离目的更远的** → 在剩余里取 **等待开窗 + delayMs** 最小者；失败标记 unhealthy 后重试。

运维对照：`GET /api/graph` 看局部图；`GET /api/graph/route?dst=` 看 culled / 时延候选 / 下一跳（控制台「连接」「操作」页也会展示）。

10 节点冒烟（引导 `node0`，`node1`–`node9` 加入；`node1`–`node8` 在 x 负半轴，避免被选成下一跳）：

```bash
bash apps/relay/scripts/join-cluster.sh
# 默认端口 3320–3329，收件箱等待 JOIN_TIMEOUT_SEC=120
JOIN_KEEP=1 bash apps/relay/scripts/join-cluster.sh
DTN_LIVE_GRAPH=1 npm test -w @lightlink/relay -- src/live-graph-join.test.ts
```

未设置 `DTN_LIVE_GRAPH=1` 时该测试跳过。杀掉星型拓扑里的 `node1`–`node8` **不会**改写 `node0 → node9` 直连；要演示绕路，需要网状或短链（至少两个更近且能继续前送的邻居）。

### BPv7 编解码（bplib FFI）

| 变量 | 说明 |
|------|------|
| （默认） | `native/bp-codec/build/libdtn_bp_codec.dylib`（Darwin）或 `.so`（Linux） |
| `DTN_BP_CODEC_LIB` | 覆盖库路径；缺失则**启动失败** |
| `DTN_ALLOW_JSON_INGEST=1` | `POST /api/peer/ingest` 额外接受旧 JSON（回归用）；默认关闭；出口仍为 CBOR |

包装导出：`dtn_bp_encode` / `dtn_bp_decode` / `dtn_bp_inspect`。构建与依赖见 [`native/bp-codec/README.md`](./native/bp-codec/README.md)。

### 萤火控制台（LightLink Console）

各 relay 根路径 `/`（如 `http://127.0.0.1:3101/`）。顶栏：**节点名 · 端口** → 角色 / 接触开闭 / uptime → **居中文字菜单** → 刷新 / 语言 / 主题 / 对端。

| 页 | 层 | 内容 |
|----|----|------|
| 概览 | 总览 | 存储深度、已知节点、近期束、节点信息、接触窗口 |
| 存储 | 运维 | bundles / custody / index / inbox 深度 |
| 连接 | 网络 | 坐标网络图、边明细、接触计划、EID、选路边对照 |
| 操作 | 业务 | 发送 / 收件箱（仅节点名与载荷）；试算选路 |
| 束 | 运维 | 列表、状态、时间线、主块摘要（`primary`）、束长度 |
| 日志 | 运维 | `recentEvents` 实时刷新 |

业务 API：`POST /api/send` 成功体仅 `ok,id,src,dst,payload,ttlMs`；`GET /api/inbox|recv` 无 EID。运维：`GET /api/bundles`、`GET /api/bundles/:id`。

### HTTP API（daemon 摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/status` | 节点、三库深度、接触、近期事件 |
| GET | `/api/contacts` | 接触窗口；`wireFormat: application/cbor` |
| GET | `/api/graph` | 局部接触图（graph 模式） |
| GET | `/api/graph/route?dst=` | 选路试算 |
| POST | `/api/peer/join` | 动态加入 |
| POST | `/api/peer/graph` | 接触摘要 gossip |
| POST | `/api/send` | 本地注入 |
| GET | `/api/recv` · `/api/inbox` | 收件箱 |
| GET | `/api/bundles` · `/api/bundles/:id` | 列表 / 运维详情 |
| POST | `/api/peer/ingest` | CLA（默认 CBOR） |
| POST | `/api/peer/ack` | 保管释放 |
| GET | `/` | 萤火控制台 |

### 可选：旧双节点（Earth↔Mars 直连）

仍保留 `apps/relay/contact-plan.dual.json`（20s 周期，**[5s,15s) OPEN**）。只需 **两个** 进程时，显式指定计划并省略中间 Relay：

```bash
CONTACT_PLAN=apps/relay/contact-plan.dual.json npm run relay:earth
CONTACT_PLAN=apps/relay/contact-plan.dual.json npm run relay:mars
```

### CLI 一览

```bash
npm run cli -- help
npm run cli -- status
npm run cli -- send Mars "payload"
npm run cli -- recv
npm run cli -- inbox
npm run cli -- wait 60
```

### SDK（`@lightlink/sdk`）

```ts
import { DtnClient, marsClient } from '@lightlink/sdk';

const earth = new DtnClient({ baseUrl: 'http://127.0.0.1:3101' });
await earth.send('Mars', 'Hello');
const msgs = await marsClient().subscribeDelivery({ timeoutMs: 60000 });
```

## 旧仿真路径（可选）

```bash
npm run demo                 # CLI 离散仿真
npm run api                  # Nest 仿真 API :3001
npm run web                  # Next UI :3000（时间线 + /replay）
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/simulate` | 跑仿真并持久化到 LevelDB runs |
| GET | `/api/runs` | 运行列表 |

仿真 runs：`apps/api/data/dtn-runs/`（gitignore）。

## Kubernetes（Future / dry-run）

```bash
kubectl apply --dry-run=client -k k8s/
```

3-node（Earth↔Relay↔Mars）+ 真实编排见设计文档 §Future，**本阶段不强制**。

## 场景（三节点 wall-clock）

| 阶段 | 事件 |
|------|------|
| Earth–Relay CLOSED | Earth `send` → 本机 **WAITING** / STORED；已编码进 custody |
| Earth–Relay OPEN | Earth → Relay CBOR ingest；Relay 保管，等待 Relay–Mars 窗口 |
| Relay–Mars OPEN | Relay → Mars **DELIVER** + ACK 回传 |
| 本地 | Mars `recv` / SDK `subscribeDelivery`；Earth 控制台见 **ARRIVED** |

## 测试

```bash
npm run test:relay                                          # 单元（含 graph / codec / 状态机）
DTN_LIVE_SMOKE=1 npm run test:relay:live                    # 三节点 live（需 3101/3102/3103）
DTN_LIVE_GRAPH=1 npm test -w @lightlink/relay -- src/live-graph-join.test.ts
```

## 许可

MIT
