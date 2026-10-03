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

图模式 `decideNextHop` 已是 **SABR 风格薄实现**：只走更近邻居，代价 = 等到开窗 + 传播时延 + 角色罚分。不是完整 CGR（无多跳接触图搜索、无 coped 容量）。

## K8s（D）

`k8s/nodes.yaml` stub 容器环境变量与 daemon 对齐：`NODE_ID`／`PORT`／`CONTACT_PLAN`。镜像仍是 sleep 占位，可 `kubectl apply -k k8s/` 看 CRD／ConfigMap。
