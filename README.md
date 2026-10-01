# DTN Demo — 延迟/中断容忍网络教学演示

TypeScript monorepo：**常驻三节点 relay daemon（NestJS）** 为主路径（Earth → Relay → Mars）；本地 **CLI / SDK** 只连 `localhost`；**Next.js** 提供接触计划页与旧仿真可视化；**Kubernetes YAML** 示意日程感知调度（Future）。灵感来自 Bundle Protocol，**不是**完整 BP / ION。

约束见 [`AGENTS.md`](./AGENTS.md)。设计见 [`docs/relay-daemon-design.md`](./docs/relay-daemon-design.md) 与 [`docs/superpowers/specs/2026-10-01-dtn-three-node-design.md`](./docs/superpowers/specs/2026-10-01-dtn-three-node-design.md)。

## 仓库结构

```
dtn-demo/
├── AGENTS.md
├── README.md
├── docs/relay-daemon-design.md  # relay daemon 架构（含旧双节点对照）
├── docs/k8s-dtn-scheduling.md   # 3-node + K8s Future 草图
├── k8s/                         # CRD、节点、CronJob/控制器、接触计划
├── data/Earth|Relay|Mars/       # LevelDB×3（gitignore）
├── packages/dtn-core/           # 旧离散仿真核心（仍可用）
├── packages/dtn-sdk/            # TypeScript 客户端 send/recv/subscribe
├── packages/dtn-cli/            # CLI：status / send / recv / wait
├── apps/relay/                  # NestJS 常驻 relay daemon
├── apps/api/                    # 旧仿真 Nest API :3001
└── apps/web/                    # Next.js：/relay 控制台 + 旧仿真 UI
```

## 快速开始（三节点 — 推荐）

```bash
cd /Users/bruce/git/space/dtn-demo
npm install

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

关窗时发往下一跳的 bundle 会 **WAITING**（保管）；开窗后 **FORWARD → … → DELIVER**，Mars 侧 `recv` / `wait` 取走；Earth 可在控制台报文时间线看到 **ARRIVED** 确认。

环境变量：`NODE_ID`、`PORT`、`PEER_URL`、`DATA_DIR`、`CONTACT_PLAN`；CLI 用 `DTN_RELAY_URL` 或 `DTN_NODE=Earth|Relay|Mars`。

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

### SDK（`@dtn-demo/sdk`）

```ts
import { DtnClient, marsClient } from '@dtn-demo/sdk';

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
| Earth–Relay CLOSED | Earth `send` → 本机 **WAITING** / STORED |
| Earth–Relay OPEN | Earth → Relay ingest；Relay 保管，等待 Relay–Mars 窗口 |
| Relay–Mars OPEN | Relay → Mars **DELIVER** + ACK 回传 |
| 本地 | Mars `recv` / SDK `subscribeDelivery`；Earth 控制台见 **ARRIVED** |

## 许可

MIT
