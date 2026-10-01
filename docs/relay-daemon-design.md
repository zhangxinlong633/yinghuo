# Relay Daemon 设计 — Dual-Relay DTN（双中继）

> **默认路径**：三节点 Earth–Relay–Mars 以 [`docs/superpowers/specs/2026-10-01-dtn-three-node-design.md`](./superpowers/specs/2026-10-01-dtn-three-node-design.md) 为准（默认计划 `contact-plan.tri.json`、端口 3101 / 3103 / 3102）。**下文**若只描述 Earth↔Mars 两进程、直连 peer 与 `contact-plan.dual.json`，指的是保留作对照的**旧双节点模式**，不是当前推荐启动方式。

> English identifiers kept as-is. 本文描述 **resident relay daemon** 架构；进程内离散仿真（`@lightlink/core` Simulator）仍保留作教学对照，**daemon 为新的主路径**。

## 1. 目标与范围

| 项 | 说明 |
|----|------|
| 目标 | 每台机器跑常驻 **NestJS relay daemon**；本地 CLI / SDK **只连本机** `localhost`；DTN 网络 = **relay↔relay** |
| 本阶段 | **双中继**：同一 Mac 上 `Earth (:3101)` + `Mars (:3102)`，独立 `data/<nodeId>/`，周期接触窗口演示 store-and-forward |
| 非目标 | 完整 Bundle Protocol / ION；本阶段不做真实 3 节点 + K8s 编排（见 §7 Future） |

## 2. 架构总览

```
┌─────────────┐   HTTP localhost    ┌──────────────────┐
│ dtn-cli /   │ ──────────────────► │ Relay Earth:3101 │
│ dtn-sdk     │                     │ LevelDB×3        │
└─────────────┘                     └────────┬─────────┘
                                             │ peer CLA
                                             │ (仅接触窗口 OPEN)
                                             ▼
┌─────────────┐   HTTP localhost    ┌──────────────────┐
│ dtn-cli /   │ ──────────────────► │ Relay Mars:3102  │
│ dtn-sdk     │                     │ LevelDB×3        │
└─────────────┘                     └──────────────────┘
```

- **Local plane**：应用 / CLI / SDK → `POST /api/send`、`GET /api/recv`
- **Network plane**：daemon → daemon `POST /api/peer/ingest` + `POST /api/peer/ack`（CLA 简化）；线上 body 为 **BPv7 CBOR**（`Content-Type: application/cbor`，`x-dtn-from` 为上一跳节点名）
- 接触关闭时 peer ingest 返回 **503 CONTACT_CLOSED**，发送方继续 **custody** 保管

## 3. 节点与端口

| nodeId | Port | Peer URL | LevelDB 根 |
|--------|------|----------|------------|
| `Earth` | `3101` | `http://127.0.0.1:3102` | `data/Earth/{bundles,custody,index}/` |
| `Mars` | `3102` | `http://127.0.0.1:3101` | `data/Mars/{bundles,custody,index}/` |

内置控制台：`http://localhost:3101/`（Mars：`http://localhost:3102/`）。Next.js 接触计划页：`http://localhost:3000/`。

## 4. 三库 LevelDB（classic-level）

每个 relay 在 `data/<nodeId>/` 下打开三个独立 DB：

| DB | 用途 |
|----|------|
| `bundles` | Bundle 本体 JSON（id → RelayBundle） |
| `custody` | 保管记录（waitingAck / from / heldAt） |
| `index` | 辅助索引：`bundle:` / `pending:` / `inbox:` 投递回执 |

与旧仿真 API 的单一 `apps/api/data/dtn-runs` **分离**；daemon 数据目录已 gitignore。

## 5. 接触计划（wall-clock cyclic）

文件：`apps/relay/contact-plan.dual.json`

- `schedule.type = cyclic`
- `periodMs = 20000`，`openOffsetMs = 5000`，`openDurationMs = 10000`
- 即每个 20s 周期内：**[5s, 15s) OPEN**，其余 CLOSED
- 演示路径：窗口关闭时 CLI `send` → Earth **STORE**；窗口打开 → **FORWARD** → Mars **DELIVER** → SDK/`recv` 取走

延迟：`delayMs` 模拟传播（默认 200ms）。

## 6. HTTP API（daemon）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/status` | 节点、三库深度、接触状态、近期事件 |
| GET | `/api/contacts` | 当前接触窗口状态 |
| POST | `/api/send` | 本地注入 `{ dst, payload, ttlMs? }`；成功 JSON **仅** `ok,id,src,dst,payload,ttlMs` |
| GET | `/api/recv?clear=` | 轮询本地投递 inbox（业务字段，无 EID） |
| GET | `/api/inbox` | 窥视 inbox（不清空） |
| GET | `/api/bundles/:id` | 运维详情：状态、时间线、`primary`（主块摘要）、`wireLength` |
| POST | `/api/peer/ingest` | 对端 CLA；默认 **application/cbor**；窗口关闭 → 503；解码失败 → 400 |
| POST | `/api/peer/ack` | 保管释放 |
| GET | `/` | 内置 HTML 控制台（操作 / 连接 / 报文 三层） |

## 7. Future：3-node + Kubernetes

保留现有 `k8s/` 与 `docs/k8s-dtn-scheduling.md` 作为 **Earth ↔ Relay ↔ Mars** 日程感知调度草图：

1. 第三进程 `Relay (:3103)` + 两段接触（Earth–Relay、Relay–Mars）
2. ConfigMap 接触计划驱动 daemon 热加载
3. NetworkPolicy / CronJob 对齐窗口
4. PVC 替代本地 `data/` 目录

**当前 dual 模式刻意压成 Earth↔Mars 直连**，以便在一台 Mac 上最快验证「关窗存储 → 开窗投递」。

## 8. BPv7 编解码（bplib）与构建

节点间字节由 **bplib** 经薄 C 包装（`native/bp-codec/`）编成 BPv7 CBOR。Nest 仍负责保管、接触窗口、下一跳与 ack；编解码通过 `koffi` 加载共享库。

```bash
npm run native:build -w @lightlink/relay
# 产物：native/bp-codec/build/libdtn_bp_codec.dylib（Darwin）或 libdtn_bp_codec.so（Linux）
npm run relay:earth   # 另开终端 relay:mars、relay:relay
```

| 环境变量 | 行为 |
|----------|------|
| （默认） | 使用 monorepo 内 `native/bp-codec/build/` 下上述库名 |
| `DTN_BP_CODEC_LIB` | 绝对或相对路径覆盖；**找不到则进程启动失败**（不静默退回 JSON） |
| `DTN_ALLOW_JSON_INGEST=1` | ingest 额外接受 legacy `application/json`（如 `contact-plan.dual.json` 回归）；默认关闭。**编码出口仍为 CBOR** |

接触计划 `contact-plan.tri.json` 为每个节点配置 `eid`（Earth `ipn:1.1`、Relay `ipn:2.1`、Mars `ipn:3.1`）。转发前把节点名映射为 EID；ingest 解码后再映射回节点名。未知 EID 拒收。

`GET /api/contacts` 返回 `wireFormat: application/cbor`，表示 peer 链路上使用的媒体类型。

## 9. 内置控制台（业务 / 网络 / 运维）

每节点 `GET /` 提供三页，字段按层隔离（见 [`specs/2026-10-01-bplib-codec-design.md`](./superpowers/specs/2026-10-01-bplib-codec-design.md)）：

| 页 | 层 | 可见 | 不可见 |
|----|----|------|--------|
| 操作 | 业务 | 目的节点、载荷、TTL、已受理；收件箱源/目的/载荷/到达时间 | EID、CBOR、转发状态、时间线、hex |
| 连接 | 网络 | 接触窗口、下一跳、本节点与对端 EID、线上 BPv7 | 载荷正文、收件箱 |
| 报文 | 运维 | 状态、时间线、主块摘要（版本、源/目的 EID、lifetime、hex32）、束字节长度 | 整束 hex |

概览与存储深度仍来自 `/api/status` 三库计数。

## 10. 接触图模式（join）

静态三节点计划仍是默认启动方式。`DTN_GRAPH_MODE=1`（或计划 `mode: "graph"`）改为局部接触图：

| 变量 | 作用 |
|------|------|
| `DTN_GRAPH_MODE=1` | 启用图模式；`NODE_ID` 可以不在接触计划里 |
| `BOOTSTRAP_URL` | 已在网中的引导节点，如 `http://127.0.0.1:3320`。不设则本进程是引导岛 |
| `PEER_URL` | 本节点可被回调的地址；join 请求体必填，缺了会停在单机岛 |
| `NODE_X` / `NODE_Y` | 平面坐标，覆盖计划里的坐标 |
| `EID` | 本节点 EID；计划里没有该 `NODE_ID` 时必须设置 |
| `PORT` / `DATA_DIR` | 与静态模式相同，每进程独立 |

`POST /api/peer/join` 把对方记为直连种子，并给出一条周期 30s、全程打开的接触，响应里带接触摘要。之后仅在对该邻居窗口打开时 `POST /api/peer/graph`（间隔约 2s）。`GET /api/graph` 是本机已知节点与边；`GET /api/graph/route?dst=` 是只读选路（更近邻居里时延最小；失败邻居会标 unhealthy）。

业务 `POST /api/send` 与 `GET /api/inbox` 形状不变。

10 进程验收：

```bash
bash apps/relay/scripts/join-cluster.sh
```

`node0` 监听 `BASE_PORT`（默认 3320），不设引导。`node1`–`node9` 的 `BOOTSTRAP_URL` 指向它。坐标把 `node0` 放在 x=0、`node9` 放在 x=100、其余放在负 x：星型加入时只有引导持有全部 peer URL，贪心选路会把负 x 上的节点裁掉，从而 `node0` 直送 `node9`。脚本等待 gossip（`node1` 的图里出现 `hopCount > 0` 的边，且已知全部节点）再发送，并在 `JOIN_TIMEOUT_SEC`（默认 120）内轮询 `node9` 的 inbox。摘要里的 `direct` 标记会原样合并，所以这些边在 `GET /api/graph` 上仍可能是 `kind: "direct"`。

`JOIN_KEEP=1` 留下进程后，可用 `DTN_LIVE_GRAPH=1` 跑 `apps/relay/src/live-graph-join.test.ts`（默认跳过）。

可选故障：停掉负 x 上的某一台不改变这条直连。要验证替代下一跳，种子坐标上需要两条都能更接近目的地、且下一跳自己还能转发的方向。

## 11. 包与脚本

| 包 | 角色 |
|----|------|
| `apps/relay` | NestJS 常驻 daemon |
| `packages/dtn-sdk` | `DtnClient` send/recv/subscribeDelivery |
| `packages/dtn-cli` | `npm run cli -- …` |
| `packages/dtn-core` | 旧离散仿真核心（仍可用 `npm run demo`） |
| `apps/api` / `apps/web` | 旧仿真 API + UI；`/relay` 为新控制台 |

根脚本：`relay:earth`、`relay:relay`、`relay:mars`、`cli`；relay 包内 `native:build` 编译共享库。
