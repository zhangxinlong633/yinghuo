# DTN Demo — 延迟/中断容忍网络教学演示

TypeScript monorepo：**常驻双中继 daemon（NestJS）** 为主路径；本地 **CLI / SDK** 只连 `localhost`；**Next.js** 提供 Relay Console 与旧仿真可视化；**Kubernetes YAML** 示意日程感知调度（Future 3-node）。灵感来自 Bundle Protocol，**不是**完整 BP / ION。

约束见 [`AGENTS.md`](./AGENTS.md)。设计见 [`docs/relay-daemon-design.md`](./docs/relay-daemon-design.md)。

## 仓库结构

```
dtn-demo/
├── AGENTS.md
├── README.md
├── docs/relay-daemon-design.md  # 双中继 daemon 架构（主路径）
├── docs/k8s-dtn-scheduling.md   # 3-node + K8s Future 草图
├── k8s/                         # CRD、节点、CronJob/控制器、接触计划
├── data/Earth|Mars/             # LevelDB×3（gitignore）
├── packages/dtn-core/           # 旧离散仿真核心（仍可用）
├── packages/dtn-sdk/            # TypeScript 客户端 send/recv/subscribe
├── packages/dtn-cli/            # CLI：status / send / recv / wait
├── apps/relay/                  # NestJS 常驻 relay daemon
├── apps/api/                    # 旧仿真 Nest API :3001
└── apps/web/                    # Next.js：/relay 控制台 + 旧仿真 UI
```

## 快速开始（双中继 — 推荐）

```bash
cd /Users/bruce/git/space/dtn-demo
npm install

# 终端 1 — Earth relay :3101，数据 data/Earth/{bundles,custody,index}/
npm run relay:earth

# 终端 2 — Mars relay :3102，数据 data/Mars/{bundles,custody,index}/
npm run relay:mars

# 终端 3 — 状态 / 发送 / 等待投递
npm run cli -- status
DTN_NODE=Earth npm run cli -- send Mars "Hello Mars"
DTN_NODE=Mars  npm run cli -- wait 60

# 可选：Next.js 接触计划页 :3000（需 web；relay 已启动）
npm run web
# http://localhost:3000/
# 中继首页：http://localhost:3101/ 与 http://localhost:3102/
```

### 端口与路径

| 节点 | 端口 | Peer | LevelDB |
|------|------|------|---------|
| Earth | 3101 | `http://127.0.0.1:3102` | `data/Earth/{bundles,custody,index}/` |
| Mars | 3102 | `http://127.0.0.1:3101` | `data/Mars/{bundles,custody,index}/` |

接触计划：`apps/relay/contact-plan.dual.json` — 周期 **20s**，其中 **[5s,15s) OPEN**。关窗时 `send` 会 **STORE**；开窗后 **FORWARD → DELIVER**，Mars 侧 `recv` / `wait` 取走。

环境变量：`NODE_ID`、`PORT`、`PEER_URL`、`DATA_DIR`、`CONTACT_PLAN`；CLI 用 `DTN_RELAY_URL` 或 `DTN_NODE=Earth|Mars`。

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

## 场景（dual wall-clock）

| 阶段 | 事件 |
|------|------|
| 窗口 CLOSED | Earth CLI `send` → Bundle 写入 `bundles`+`custody` |
| 窗口 OPEN | Earth → Mars `peer/ingest` → Mars **DELIVER** + ACK |
| 本地 | Mars `recv` / SDK `subscribeDelivery` 取出 payload |

## 许可

MIT
