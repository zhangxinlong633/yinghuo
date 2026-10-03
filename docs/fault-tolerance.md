# 分布式、容错与空间辐射（萤火）

廉价开发板组 DTN 时，萤火按 **store-and-forward + 冷副本 + 哈希核对** 工作：节点本地保管，接触开窗再推 BPv7；邻居挂了就换路或提升副本；载荷翻了就标出来并换一份好的。对照当前实现与 [`hardware.md`](./hardware.md)／[`satellite.md`](./satellite.md)。

一句话：软件把每个节点当成可牺牲的保管点；图连通、副本在、哈希对得上，转发就能继续。

## 分布式

每个节点用本机 LevelDB 保管，接触开窗再推 BPv7 CBOR。身份是节点名 + EID，接触图靠局部 gossip 生长。选路用接触时延（默认 CGR 最早到达，没有端到端路径时回退 SABR-lite），跟「谁心跳最新」无关。

冷副本把主保管束再放到最多 `DTN_REPLICA_N`（默认 2）个邻居上，策略 `quality`／`nearest`／`far` 按**当前**图状态排。两份副本可以同时提升；目的地按 bundle id 去重，迟到的同一 id 记 `DUPLICATE`。分区期间各保管点独立推进，连通后按 id 合并。

可选 `DTN_REGION`：每个节点只合并本区摘要；`edge` 不把全网图带在身上；跨区走 `backbone` 区门（`DTN_REGION_PEERS`）。平面坐标 `NODE_X`／`NODE_Y` 配合接触 `delayMs`（可由星历弧写入计划）表达距离；光时长的链路上用接触窗和时延选路，而不是多数派心跳。网状多邻居时，挂一台仍有另一条边可走。

## 容错

故障模型是节点崩溃与链路长时间断开。软件侧已经接上的动作：

| 情况 | 软件做什么 |
|------|------------|
| 下一跳进程死 / 转发失败 | `markUnhealthy`（默认 30s），CGR／SABR 改选健康邻居 |
| 当前保管者下线 | 哈希通过的副本 `PROMOTE`，接管 custody 并继续转发 |
| 某一副本节点没了 | 主路径照转；其余副本仍在 |
| 接触关窗 | 本机盘保管；关窗不等于死亡，不提升 |
| 载荷被改 / 盘翻比特 | `x-dtn-payload-sha256` 核对，对不上标 `CORRUPT`，好副本继续提升 |
| 进程复位 / 冷启动 | 全库 `AUDIT`：TTL 过期标 `EXPIRE`，有哈希但对不上标 `CORRUPT` |

关窗只保管、不提升：暂时看不见不等于保管者阵亡。`DTN_REPLICA_PROMOTE=0` 可关提升。网状拓扑、`far` 把副本放到更远节点名上，和多星各一板一起，把物理故障域拆开。一线路径上 Relay 仍是必经点时，给 Relay 旁路或给束做副本，提升才有下一跳可走。

## 宇宙射线

廉价开发板按发现坏数据、换一份好数据来扛 SEU／SEFI：

- 线上 BPv7 块 CRC16，挡住一部分传输误码。
- 载荷 SHA-256 走 `x-dtn-payload-sha256`；入站只信这个头，不现场对载荷重算，传输损坏会在核对时暴露。对不上 `CORRUPT`，另一份好副本可以 `PROMOTE`。
- 进程被打到复位：邻居标 unhealthy，活着的好副本接管；本机起来先 `AUDIT` 再转发。
- 位置用星历预报写入 `delayMs` 即可，不依赖板上 GPS。

程序段、内核或 LevelDB 元数据被翻转时，靠多星、ECC、硬件看门狗和复位把节点送回「可审计的保管点」。电源／射频锁死同样走硬件复位。三板同舱时把它们当成同一故障域，副本策略配到别的星上更有效。

## 和文档的关系

| 文档 | 内容 |
|------|------|
| [`hardware.md`](./hardware.md) | 开发板算力 |
| [`satellite.md`](./satellite.md) | 1U、电源、业余射频、发射成本 |
| [`antenna.md`](./antenna.md) | 太阳系各档物理层 |
| [`interop.md`](./interop.md) | 副本份数、策略、提升、开机核对、区域／档位 |
| 本文 | 分布式怎么分工、故障怎么接、辐射下核对什么 |

实现开关：`DTN_REPLICA_N`、`DTN_REPLICA_STRATEGY`、`DTN_REPLICA_PROMOTE`、`DTN_UNHEALTHY_MS`、`DTN_CGR`、`DTN_REGION`、`DTN_TIER`、`DTN_REGION_PEERS`。设计见 [`superpowers/specs/2026-10-03-replica-promote-hash-design.md`](./superpowers/specs/2026-10-03-replica-promote-hash-design.md)、[`superpowers/specs/2026-10-03-region-tier-scale-design.md`](./superpowers/specs/2026-10-03-region-tier-scale-design.md)。
