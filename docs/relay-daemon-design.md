# Relay Daemon 设计 — Dual-Relay DTN（双中继）

> **默认路径**：三节点 Earth–Relay–Mars 以 [`docs/superpowers/specs/2026-10-01-dtn-three-node-design.md`](./superpowers/specs/2026-10-01-dtn-three-node-design.md) 为准（默认计划 `contact-plan.tri.json`、端口 3101 / 3103 / 3102）。**下文**若只描述 Earth↔Mars 两进程、直连 peer 与 `contact-plan.dual.json`，指的是保留作对照的**旧双节点模式**，不是当前推荐启动方式。

> English identifiers kept as-is. 本文描述 **resident relay daemon** 架构；进程内离散仿真（`@dtn-demo/core` Simulator）仍保留作教学对照，**daemon 为新的主路径**。

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
- **Network plane**：daemon → daemon `POST /api/peer/ingest` + `POST /api/peer/ack`（CLA 简化）
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
| POST | `/api/send` | 本地注入 `{ dst, payload, ttlMs? }` |
| GET | `/api/recv?clear=` | 轮询本地投递 inbox |
| GET | `/api/inbox` | 窥视 inbox（不清空） |
| POST | `/api/peer/ingest` | 对端 CLA；窗口关闭 → 503 |
| POST | `/api/peer/ack` | 保管释放 |
| GET | `/` | 内置 HTML 控制台（浅绿 / 深绿主题） |

## 7. Future：3-node + Kubernetes

保留现有 `k8s/` 与 `docs/k8s-dtn-scheduling.md` 作为 **Earth ↔ Relay ↔ Mars** 日程感知调度草图：

1. 第三进程 `Relay (:3103)` + 两段接触（Earth–Relay、Relay–Mars）
2. ConfigMap 接触计划驱动 daemon 热加载
3. NetworkPolicy / CronJob 对齐窗口
4. PVC 替代本地 `data/` 目录

**当前 dual 模式刻意压成 Earth↔Mars 直连**，以便在一台 Mac 上最快验证「关窗存储 → 开窗投递」。

## 8. 包与脚本

| 包 | 角色 |
|----|------|
| `apps/relay` | NestJS 常驻 daemon |
| `packages/dtn-sdk` | `DtnClient` send/recv/subscribeDelivery |
| `packages/dtn-cli` | `npm run cli -- …` |
| `packages/dtn-core` | 旧离散仿真核心（仍可用 `npm run demo`） |
| `apps/api` / `apps/web` | 旧仿真 API + UI；`/relay` 为新控制台 |

根脚本：`relay:earth`、`relay:mars`、`cli`。
