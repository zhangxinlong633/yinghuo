# Yinghuo 路线差距（相对愿景）

对照 [`docs/vision.md`](./vision.md)：目标是太阳系各处都有束递节点在跑。本文记录**现状 → 愿景**的差距，按近／中／远排列，供后续排期。

**近程切片（2026-10）已全部勾完**——长时延日程、多岛／桥、角色策略、计划热更新、本机 MCP。骨架（关窗保管、逐跳转发、局部接触图、业务／网络／运维分层、BPv7）视为基线，不再重复列为待办。

---

## 已交付（近 · 摘要）

| 主题 | 关键产物 |
|------|----------|
| 长时延／绝对窗 | `contact-plan.tri-long.json`、`tri-absolute.json`；`remainLabel`／`delayLabel` |
| 多岛／桥／unhealthy | `dual-island.sh`、`unhealthy-retry.sh`；`componentId`；`POST /api/graph/join` |
| 角色 | `ground`／`orbiter`／`lander`／`cruise`；`role-policy`；选路 `rolePenaltyMs` |
| 计划可运营 | `POST /api/plan/reload`、文件监视、`GET /api/plan` |
| Agent 入口 | `@yinghuo/mcp` stdio（Cursor 等本机 Agent） |
| 控制台信任／验收 | 计划横幅 + 磁盘重载；`apps/relay/scripts/smoke-all.sh`（`npm run smoke`） |

设计／计划文档：`docs/superpowers/specs/`、`docs/superpowers/plans/`。

---

## 近（剩余／新切）

本仓库仍可小步推进、但优先级已低于中期架构项：

### Agent 入口补强

- [x] 远程 HTTP MCP 工具网关与 Bearer 鉴权（`npm run mcp:http`；非完整 SSE MCP）
- [x] MCP 只读／写（`YINGHUO_MCP_MODE`）+ JSONL 审计（`YINGHUO_MCP_AUDIT`）

### 体验与验收

- [x] 控制台按角色／计划错误的更完整引导（热更失败、禁发原因）
- [x] 一键冒烟汇总脚本（unit + 可选 dual-island／unhealthy；tri live 仍用 `test:relay:live`）

---

## 中（架构与部署要加长 · 当前主战场）

面向「更像真实任务编排」，仍不必对接完整深空网。

### 时间与外生输入

- [x] 任务时钟／历元（`MISSION_EPOCH_MS`／`GET /api/clock`；接触窗走 missionNow）
- [x] 星历弧 → 接触计划适配器（`ephemeris-adapter.ts`；不算轨道力学）

### 资源与排队

- [ ] 真正使用 `bandwidthBps`（或等价）约束转发吞吐
- [x] 冷副本 2 份（`DTN_REPLICA_N`，不接管 custody）；**副本提升（`DTN_REPLICA_PROMOTE` + `payloadSha256`）已做**；**状态同步仍开放**
- [ ] 保管队列、优先级束、拥塞时丢弃／延期策略

### 身份与多任务边界

- [x] 任务／机构作用域（节点集不必全网一张图）— **区域／档位／区门切片已做**（`DTN_REGION`／`DTN_TIER`／`DTN_REGION_PEERS`）；**跨任务 PKI／机构级认证仍开放**
- [x] Join token（`DTN_JOIN_TOKEN`）+ 远程 MCP Bearer；业务级「谁可投递何种载荷」仍开放

### 部署形态

- [x] 多主机常驻部署指南与配置 — `docs/deploy.md` + `deploy/systemd/`
- [x] 三机计划模板 `contact-plan.tri-hosts.json`（`${EARTH_URL}` 等）
- [x] `k8s/nodes.yaml` 环境变量与 daemon 对齐（`NODE_ID`／`PORT`／`CONTACT_PLAN`）；接触感知 controller 仍为教学 stub

---

## 远（愿景级，本阶段不排期）

对齐完整深空互操作与生产级协议栈；有近中成果后再评估。

- [x] 多跳 CGR（最早到达）+ SABR-lite 回退；**ION 级 coped／完整 SABR 仍开放**
- [x] BPSec **演示头** `x-dtn-bpsec: integrity`（`DTN_BPSEC=1`）；**非** CCSDS BPSec／分片／ION
- [x] 星历弧适配器作为 DSN／任务管线的输入侧钩子；**不对接真实 DSN**
- [ ] 跨厂商、跨机构规模化互通与认证体系
- [ ] 太阳系尺度下的容量规划、故障域与长期归档

---

## 建议落地顺序（摘要）

1. ~~近：长时延 · 多岛 · 角色 · 计划热更 · 本机 MCP~~ **（已完成）**
2. ~~中：同机常驻 + 远程 MCP HTTP／历元／三机模板／互操作钩子~~ **（带宽限速仍暂缓；完整 CGR／DSN 仍远）**  
3. **中：任务／机构作用域 + 保管排队** — 区域切片已做；PKI／排队仍开放  
4. **中：`bandwidthBps` 真实限速**  
5. **中：多节点状态同步（主节点挂掉后）** — 副本提升已做  
6. **远：完整 CGR／CCSDS BPSec／真实 DSN**  

具体实现仍按单轮切片开 spec／plan；本文只作差距与待办台账，不替代设计文档。
