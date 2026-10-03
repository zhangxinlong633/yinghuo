# 互操作薄切片（历元／星历／BPSec／CGR／DSN）

这些不是完整深空栈。带宽限速（`bandwidthBps`）仍未实现。完整 CGR／CCSDS BPSec／DSN 入网仍属远景。

## 任务时钟（C）

| 环境变量 | 含义 |
|----------|------|
| `MISSION_EPOCH_MS` | 任务 T0 的 Unix ms。接触窗用 `wall - epoch`。 |
| `MISSION_CLOCK_OFFSET_MS` | 无 epoch 时给墙钟加偏移（调试用）。 |

`GET /api/clock` 与 `GET /api/status` 的 `clock` 字段同时给出 `wallMs`／`missionMs`。

## 星历 → 接触弧（E 输入侧）

`arcsToContactPlan()`（`apps/relay/src/contact/ephemeris-adapter.ts`）把 `{a,b,startMs,endMs,delayMs}` 变成 absolute 计划。DSN／轨道根数本身不在本仓库；任务方算完弧再喂进来。

## Join 信任（B／身份）

`DTN_JOIN_TOKEN` 非空时，`POST /api/peer/join` 与 `POST /api/graph/join` 需要头 `x-yinghuo-join-token`。节点互相 join 会自动带上同一环境变量。

## BPSec 演示标记（E）

`DTN_BPSEC=1` 时，ingest 需要 `x-dtn-bpsec: integrity`。转发侧自动带该头。这**不是** CCSDS BPSec 块，只是链路钩子。

## 选路（E）

图模式默认跑 **CGR（最早到达 Dijkstra）**：在已知接触边上搜多跳路径，代价为等到开窗 + 传播时延（第一跳可加角色罚分）。没有端到端接触路径时回退 **SABR-lite**（只选地理上更近的直连邻居）。`DTN_CGR=0` 关闭 CGR。静态三节点计划同样用计划接触图做 CGR，再回退 `nextHop` 表。

这仍不是 ION 级 CGR（无 coped 容量、无联系排除表、无多副本）。

## 冷副本（节点挂掉）

默认把主保管束再复制到最多 **2** 个直连节点（`DTN_REPLICA_N`，`0` 关闭）。副本走 `x-dtn-replica: 1` + `x-dtn-force: 1`，**不接管 custody、不 ACK、不投递收件箱**；下一跳和目的地不会被选为副本。

选谁由 `DTN_REPLICA_STRATEGY` 决定（默认 `quality`），按**当前**图状态动态排：

| 值 | 含义 |
|----|------|
| `quality` / `质量` | 先避开 unhealthy，再选时延+角色罚分更低的 |
| `nearest` / `最近` | 先避开 unhealthy，再选坐标更近的 |
| `far` / `远` | 先避开 unhealthy，再选坐标更远的（故障域分散） |

副本节点挂掉不影响主路径；主节点挂掉后的状态同步尚未做。`GET /api/status` 的 `replica` 字段回显 `n`、`strategy` 与 `promote`。

`DTN_REPLICA_PROMOTE` 默认开：当 `replicaOf` 在 unhealthy 名单且 `payloadSha256` 核对通过时，副本接管 custody（事件 `PROMOTE`）。哈希对不上记 `CORRUPT`，不提升。旧束无哈希字段不提升。`0` 关闭提升。

## K8s（D）

`k8s/nodes.yaml` stub 容器环境变量与 daemon 对齐：`NODE_ID`／`PORT`／`CONTACT_PLAN`。镜像仍是 sleep 占位，可 `kubectl apply -k k8s/` 看 CRD／ConfigMap。
