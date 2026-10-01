# 三节点 DTN：状态机、中转与时间线

日期：2026-10-01

一次改动里落地三件事：Earth–Relay–Mars 三节点、报文状态机、各节点控制台上的报文时间线。教学演示，不是完整 Bundle Protocol，也不做 Kubernetes 编排。

## 目标

一条从 Earth 发往 Mars 的报文必须经过 Relay。两段接触窗口错开，任何时刻都不存在 Earth 到 Mars 的直连。报文在当前保管节点上有明确状态。每个节点的控制台能打开本机看过的报文，并按时间显示它已经发生的事件。反向确认回到 Earth 之后，Earth 上能看到全程。

## 非目标

- 不实现完整 Bundle Protocol、分片、或接触图路由算法。
- 不修改 `k8s/` 清单。
- 不删除现有双节点接触计划文件；默认启动改为三进程。
- 带宽字段只展示，不参与发送速率控制。

## 拓扑

| 节点 | 端口 | 角色 | 数据目录 |
|------|------|------|----------|
| Earth | 3101 | endpoint | `data/Earth/` |
| Relay | 3103 | relay | `data/Relay/` |
| Mars | 3102 | endpoint | `data/Mars/` |

静态下一跳：

- Earth：去 Mars 的下一跳是 Relay
- Relay：去 Mars 的下一跳是 Mars，去 Earth 的下一跳是 Earth
- Mars：去 Earth 的下一跳是 Relay

Relay 拒绝本地应用注入。`POST /api/send` 返回错误且不落库。Earth 与 Mars 接受本地 `send`。CLI 与 SDK 仍只连接本机：Earth 的 send 打到 `:3101`，Mars 的 recv / wait 打到 `:3102`。

## 接触计划

新的默认计划周期 30 秒，窗口在周期内的偏移如下：

| 接触 | 打开区间 | 延迟 |
|------|----------|------|
| Earth–Relay | `[0s, 10s)` | 200ms |
| Relay–Mars | `[15s, 25s)` | 200ms |

其余时间该段为关闭。旧的 Earth–Mars 直连计划文件保留，不作为默认。

## 状态

每条报文在当前保管节点上只有一种状态：

| 状态 | 含义 |
|------|------|
| WAITING | 去下一跳的接触关闭，继续保管 |
| FORWARDING | 接触打开，正在或即将向下一跳转发 |
| ARRIVED | 目的节点已把载荷放入本地收件箱 |
| ACKED | 本跳已收到下一跳确认，托管已释放 |
| EXPIRED | TTL 到期，离开待转发队列 |

写入 bundles 与 custody 的同一请求里就会分成 WAITING 或 FORWARDING，接口不返回一个会停住的「已存储」状态。「已存储」只出现在时间线事件里，表示这次落库。对外中文：等待窗口、转发中、已到达、已确认、已过期。

报文携带 id、src、dst、payload、createdAt、ttlMs、hops、events。events 随报文复制到下一跳，并在确认返回时把下游事件带回上游，使 Earth 能补全全程。

## 数据流

1. Earth `POST /api/send` 写入 bundles 与 custody，状态为 WAITING（接触关闭）或 FORWARDING（接触打开）。
2. Earth–Relay 打开后，Earth `POST /api/peer/ingest` 到 Relay。Relay 保管该报文并 `POST /api/peer/ack`。Earth 收到确认后释放托管，状态改为 ACKED。
3. Relay–Mars 关闭时，报文停在 Relay，状态 WAITING。
4. Relay–Mars 打开后，Relay 同样 ingest 给 Mars。
5. Mars 发现自己是目的节点，载荷进入收件箱，状态 ARRIVED，再按反向接触把确认送回 Relay，再送回 Earth。
6. Mars 的接收只清空本机收件箱，不触发转发。

确认与正向报文使用同一接触规则：窗口关闭则确认留在当前节点，窗口打开再送。

## 失败

失败时报文留在当前保管节点，不丢弃，也不跳过下一跳。

- 下一跳窗口关闭：ingest 返回 503，发送方回到 WAITING。
- 下一跳进程不可用或网络错误：留在发送方。当前窗口内每 1 秒重试一次；窗口结束后等到下个周期。
- 确认没有送达：下一跳已经收下，上一跳保持 FORWARDING，并在自己的接触窗口内重发。同一 bundle id 在下一跳只保留一份。
- TTL 到期：当前保管节点标 EXPIRED，移出待转发队列，事件留在时间线。已在收件箱中、尚未被取走的载荷同样作废。
- Relay 上的 `POST /api/send`：返回错误，不写库。

## 控制台

每个节点仍只提供自己的页面（`/`），顶栏菜单保留，并增加「报文」。

- 概览：除现有统计外，显示本机等待窗口、转发中、已到达、已过期的数量，以及最近几条仍在保管的报文。点一条打开详情。
- 报文：表格列为 id、源、目的、状态、当前所在节点、更新时间。点一行打开详情。
- 详情：左侧为状态与载荷，右侧为时间线。每条事件包含时间、节点、发生了什么。过期与重试写在同一条时间线上。
- 操作：发送成功的响应包含 bundle id，并链到该报文详情。接收仍只清空本机收件箱。
- 连接：列出两段接触。Earth 与 Mars 把与自己无直接接触的那一段标为上游或下游、本机不直连。Relay 上两段都是本机链路，各自有开闭和倒计时。

节点只读自己的库。Earth 在反向确认到达之前，时间线不含 Mars 的到达事件。

## 接口

在现有 `/api/send`、`/api/recv`、`/api/inbox`、`/api/peer/ingest`、`/api/peer/ack`、`/api/status`、`/api/contacts` 之上增加：

- `GET /api/bundles`：本机看过的报文摘要列表
- `GET /api/bundles/:id`：单条报文、状态、hops、events

`/api/contacts` 返回本节点所知的全部接触，并标明哪一段是本机链路。

默认脚本：

- `relay:earth` → `:3101`
- `relay:relay` → `:3103`
- `relay:mars` → `:3102`

## 验收

测试注入 `now`，拨动接触窗口，不依赖真实等待 30 秒。

- Earth–Relay 关闭时发送，报文停在 Earth，状态 WAITING。
- 只打开 Earth–Relay，报文到达 Relay 并停下，Earth 收到这一跳确认。
- 再打开 Relay–Mars，Mars 收件箱出现载荷，确认沿反向回到 Earth，Earth 时间线包含 ARRIVED。
- 转发时对端未启动，报文留在发送方，窗口内按 1 秒重试。
- 同一 id 重复 ingest，下一跳只保留一份。
- TTL 在中途到期，当前节点变为 EXPIRED，不再转发。
- Relay 的 `POST /api/send` 被拒绝且不落库。

手动：同时打开三个控制台，从 Earth 发给 Mars，两段窗口各打开一次后，Earth 详情能看到全程，Mars 接收能取出同一条载荷。
