# 副本提升与载荷 SHA-256

日期：2026-10-03

廉价节点被击中或磁盘翻坏时，活着的好副本可以接管 custody 并继续转发。完整性用载荷 SHA-256，不是 MD5，也不是 CCSDS BPSec。

## 目标

- 当前保管者进入 unhealthy（与现有转发失败标记同一套窗口）后，本机哈希校验通过的副本升为 `primary`，写入 custody，走现有选路与转发。
- 创建束时写入 `payloadSha256`；ingest、提升前、开转前核对 UTF-8 载荷。对不上记 `CORRUPT`，该副本不提升、不转发、不投递。
- 另一份未损坏的副本仍可提升。所有副本都坏且源头已不在：束终止，不向源「重要」。
- `DTN_REPLICA_PROMOTE=0` 时不提升；哈希仍写入并校验。

## 非目标

- 不实现租约、选举、exactly-once。两份副本可同时提升；目的地用现有 bundle id 去重。迟到的原主再转发同一 id 为 `DUPLICATE`。
- 不向地球或应用层自动重发。没有端到端会话。
- 不上 BPSec BIB、CRC 之外的线上海花、MD5。
- 不因接触关窗而提升。关窗仍是 store-and-forward。
- 不改 CGR／SABR、不改 `DTN_REPLICA_N`／策略选点（仍排除下一跳与目的地）。
- 没有 `payloadSha256` 的旧束：不校验，也**不**提升。

## 架构

三个小单位，边界清楚：

| 单位 | 做什么 | 怎么用 | 依赖 |
|------|--------|--------|------|
| `payload-hash` | 算 SHA-256、比对 | 创建／ingest／forward／promote 调用 | Node `crypto`，载荷字符串 |
| `replica-promote` | 纯函数：这份副本现在能否提升 | tick 传入 unhealthy 集、哈希结果、开关 | 不读盘、不发 HTTP |
| `BundleService` | 扫本地 `replicaRole===replica` 的束，调用上面两个，写 custody 再 `prepareForward` | 现有 plan tick | Graph unhealthy、store |

探测不 ping 全网。仅当 `replicaOf` 出现在 `graph.listUnhealthy()`（转发失败写入、同一 `DTN_UNHEALTHY_MS`）时才考虑提升。不新增心跳协议。关窗不是 unhealthy。

## 数据流

创建（已是 primary）：

1. 对 `payload` 做 SHA-256 hex 写入 `payloadSha256`。
2. 照旧 custody + 可选冷副本。副本字节里带上同一哈希。

副本 ingest：

1. 仍不 custody、不 ACK、不收件箱。
2. 若带哈希且对不上：保留运维记录并记 `CORRUPT`，这份不再转发、不提升、不投递。

提升（`DTN_REPLICA_PROMOTE` 非 `0`／`false`，默认开）：

1. Tick 读到 `replica` 束。
2. `replicaOf` 不在 unhealthy → 跳过。
3. 无 `payloadSha256` 或哈希失败 → 不提升。
4. 否则：`replicaRole=primary`，本节点为 `custodian`，`putCustody`，事件 `PROMOTE`，然后 `prepareForward`。

开转：哈希失败则 `CORRUPT`，不进入 FORWARDING。

## 失败

| 情况 | 行为 |
|------|------|
| 主保管关窗但未 unhealthy | 不提升 |
| 主保管 unhealthy，哈希好 | 提升并继续转 |
| 哈希坏 | `CORRUPT`，这份不转；其它好副本可提 |
| 无好副本、源头已无 custody | 束停，运维可见 CORRUPT／无 PROMOTE |
| 两副本同时提升 | 都可转；目的去重 |
| 原主复活再转同一 id | `DUPLICATE` |
| `DTN_REPLICA_PROMOTE=0` | 永不提升 |

## 配置

| 变量 | 默认 | 含义 |
|------|------|------|
| `DTN_REPLICA_PROMOTE` | 开 | `0`／`false` 关闭提升 |
| `DTN_UNHEALTHY_MS` | 30000 | 提升探测与转发回避共用 |
| `DTN_REPLICA_N`／`DTN_REPLICA_STRATEGY` | 2／quality | 不变 |

`GET /api/status` 的 `replica` 增加 `promote: boolean`。

## 测试

- SHA-256：原文通过，改一个字符失败。
- 主保管 unhealthy + 好哈希 → 副本变 primary 且有 custody。
- 坏哈希 → 不提升。
- 仅关窗 → 不提升。
- `DTN_REPLICA_PROMOTE=0` → 不提升。
- 无 `payloadSha256` 的旧束 → 不提升。

现有冷副本、CGR、unhealthy 绕路测试保持绿。
