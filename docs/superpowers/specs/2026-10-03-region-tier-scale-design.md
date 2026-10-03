# 区域与档位（水平扩展第一刀）

日期：2026-10-03

从地球上千台扩到太阳系数亿终端时，不能让每台节点看见全网图。第一刀引入**区域**和**档位**：图与 CGR 停在区内骨干；小设备只连附近中继；跨区只走区门。不是 ION、不是全太阳系扁平路由表。

## 目标

- `DTN_REGION` 开启后：Join／gossip 只合并同区；跨区仅 backbone 区门；目的不在本区时走向该区 gateway，不把外区叶子拉进本地 Map。
- `DTN_TIER=backbone|edge`（可从现有角色推断）：骨干跑区内 CGR；`edge` 不跑全图 CGR，开窗交给父骨干或最近直连 backbone。
- `edge` 摘要只含自己和直连；骨干摘要含本区图 + 短 `gateways[]`，不含外区设备名单。
- 未设 `DTN_REGION` 时：行为与现在完全一致（三节点／十节点脚本、现有单测不用改启动方式）。

## 非目标

- 不实现层级 EID、跨任务 PKI、全区副本、ION coped／联系排除表。
- 不测真实几亿进程；规模不变量是「摘要不含外区叶子」。
- 不向源自动重发；无区门时束保持 `WAITING`。
- 不改 SHA-256、`CORRUPT`、`PROMOTE`、开机 `AUDIT`、关窗不提升。
- 不把 `lander`／`ground` 的注入／投递能力改掉。

## 架构

| 单位 | 做什么 | 怎么用 | 依赖 |
|------|--------|--------|------|
| `region-policy` | 解析 `DTN_REGION`／`DTN_TIER`／`DTN_REGION_PEERS`；缺省推断；同区／区门判定 | join、gossip、选路、副本选点调用 | 环境变量、现有 `ROLE` |
| `graph-merge`／`GraphService` | 合并时丢外区；`edge` 导出裁剪；骨干导出 `gateways[]` | 现有 join／`ingestSummary`／`exportSummary` | `region-policy` |
| `graph-route`／`graph-cgr` | 区内 CGR 不变；未知 dst + `dstRegion` → 该区门；`edge` 不调用 CGR | `decide`／`pickNext` | 本地图、区门表 |
| `BundleService` | 束上可选 `dstRegion`；`edge` 在区域模式下默认不复制 | send／ingest／replicate | 上列 |

`DTN_REGION` 未设置：不调用分区裁剪，隐式同一区，档位不改变副本与 gossip。

`DTN_REGION` 已设置且未设 `DTN_TIER`：`orbiter`／`cruise` → `backbone`，其余 → `edge`。

## 数据流

### Join

`JoinRemote` 增加可选 `region`、`tier`。缺省视为与本机同一区、按角色推断档位。

1. 仍先校验 `DTN_JOIN_TOKEN`。
2. 同区：现有 `applyJoin`。
3. 外区：双方均为 `backbone` 且任一侧 `DTN_REGION_PEERS` 列出对方区（`mars=http://…` 形式，逗号分隔多区）→ 记跨区直连，该对端进入本机 `gateways`。
4. 否则 `403 { ok:false, error:'REGION_MISMATCH' }`，不写图。

`BOOTSTRAP_URL` 仍指向同区骨干。

### Gossip

间隔仍约 2s、开窗直连。

- `backbone` 导出：本区 `nodes`／`edges`（节点带 `region`、`tier`）+ `gateways[]`（`{ region, nodeId, eid }`，外区名 → 本区里连着该区的门）。不含外区叶子。
- `edge` 导出：仅自己与直连（`direct`），不转发听说边。
- `ingestSummary`：丢掉 `region` 与本区不一致的节点和边；HTTP 仍 `200 {ok:true}`，ops 可记 `GRAPH_DROP`。
- `GRAPH_MAX_HOP=3` 只约束区内听说边。

### 束

`dst` 仍是节点名。可选 `dstRegion`（`POST /api/send` 字段或头 `x-dtn-dst-region`）。同区可省略。

- 目的在本地图：选路与现在相同（骨干 CGR，失败 SABR-lite）。
- 目的不在图且无 `dstRegion`：`WAITING`，`destination not in local graph`。
- 目的不在图且有 `dstRegion`：下一跳为该区 gateway；无门则 `WAITING`，`no region gateway`。
- `edge`：不跑 CGR；优先开窗父骨干，否则最近直连 `backbone`；都没有则保管。父骨干 unhealthy 时只在直连 backbone 中改选。

`x-dtn-payload-sha256` 规则不变。跨区束同样只信该头。

### 副本

仅当 `DTN_REGION` 已设置：

- 只在同区 `backbone` 邻居中按现有 `DTN_REPLICA_STRATEGY` 选（仍排除下一跳与目的地）。
- `edge` 默认不复制（等同 `DTN_REPLICA_N=0`）；显式设置 `DTN_REPLICA_N` 仍可打开。

`DTN_REGION` 未设置：`DTN_REPLICA_N` 默认 2，选点逻辑不变。

提升与开机核对仍只扫本机库。

## 失败

| 情况 | 行为 |
|------|------|
| 外区 edge join | 403 `REGION_MISMATCH` |
| 外区摘要混入 | 丢弃对应节点／边，200，可选 `GRAPH_DROP` |
| dst 未知且无 dstRegion | `WAITING`，现有理由 |
| dstRegion 无 gateway | `WAITING`，`no region gateway` |
| edge 无可用骨干 | 本机保管到开窗 |
| 哈希失败 | 现有 `CORRUPT` |
| 未设 DTN_REGION | 与本设计落地前一致 |

## 配置

| 变量 | 默认 | 含义 |
|------|------|------|
| `DTN_REGION` | 空（关闭分区） | 本区名，非空才启用本设计 |
| `DTN_TIER` | 按 ROLE 推断 | `backbone` 或 `edge` |
| `DTN_REGION_PEERS` | 空 | 跨区骨干，`region=url`，逗号分隔 |

`GET /api/status` 增加 `region`、`tier`（未分区时 `region` 为 `null`）。`GET /api/graph` 快照可含 `gateways`。

## 测试

- `region-policy`：空 region 关闭分区；推断 tier；`REGION_PEERS` 解析。
- `mergeSummary`：丢外区节点／边；同区 hop 仍封顶 3。
- `exportSummary`：edge 无听说边；backbone 有 `gateways[]`、无外区叶子。
- HTTP：同区 join 成功；外区 edge 403；`DTN_REGION_PEERS` 下 backbone 互 join 成功。
- 选路：本区 dst 仍 CGR；`dstRegion=mars` 且有门 → nextHop 为门；无门 → 空下一跳。
- 副本：分区下 edge 默认不复制；未分区时现有 replica 单测仍绿。
- `npm test -w @yinghuo/relay` 在未设 `DTN_REGION` 时全绿。

## 实现顺序

1. `region-policy` 纯函数 + 测试。
2. 图类型／merge／export／join 403。
3. 选路：edge 捷径 + dstRegion → gateway。
4. 束字段、ingest 头、分区下副本过滤。
5. status／README／interop／fault-tolerance 各补一小节。
