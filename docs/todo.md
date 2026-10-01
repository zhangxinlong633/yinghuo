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

- [ ] 远程 HTTP／SSE MCP 与鉴权（常驻运维 Agent；本机 stdio 已交付）
- [ ] MCP 工具审计日志／细粒度只读·写权限声明（产品化）

### 体验与验收

- [x] 控制台按角色／计划错误的更完整引导（热更失败、禁发原因）
- [x] 一键冒烟汇总脚本（unit + 可选 dual-island／unhealthy；tri live 仍用 `test:relay:live`）

---

## 中（架构与部署要加长 · 当前主战场）

面向「更像真实任务编排」，仍不必对接完整深空网。

### 时间与外生输入

- [ ] 引入任务时钟／历元模型（不只是本机 wall-clock 取模）
- [ ] 星历或外生接触源适配器接口（输入轨道／遮挡 → 输出接触弧）

### 资源与排队

- [ ] 真正使用 `bandwidthBps`（或等价）约束转发吞吐
- [ ] 保管队列、优先级束、拥塞时丢弃／延期策略

### 身份与多任务边界

- [ ] 任务／机构作用域（节点集不必全网一张图）
- [ ] 基础信任与数据策略钩子（谁可 join、谁可投递何种业务；可与远程 MCP 鉴权合流）

### 部署形态

- [ ] 多主机常驻部署指南与配置（非仅本机多进程）
- [ ] 充实 `k8s/` 至可 dry-run／可叙述的接触感知调度，并与 daemon 配置对齐

---

## 远（愿景级，本阶段不排期）

对齐完整深空互操作与生产级协议栈；有近中成果后再评估。

- [ ] 完整接触图路由（CGR／SABR 等），而非当前启发式局部选路
- [ ] BPSec、分片、完整 Bundle Protocol／ION 级兼容目标（若需要）
- [ ] 与真实 DSN／任务管线对接
- [ ] 跨厂商、跨机构规模化互通与认证体系
- [ ] 太阳系尺度下的容量规划、故障域与长期归档

---

## 建议落地顺序（摘要）

1. ~~近：长时延 · 多岛 · 角色 · 计划热更 · 本机 MCP~~ **（已完成）**
2. **中：任务时钟／历元 + 带宽真正限速** — 向真实任务体感靠拢  
3. **中：身份／信任 + 远程 MCP 鉴权** — Agent／多任务边界  
4. **中：多主机／k8s 叙述与配置对齐** — 可常驻部署  
5. **远：CGR／BPSec／DSN 互操作** — 单独立项  

具体实现仍按单轮切片开 spec／plan；本文只作差距与待办台账，不替代设计文档。
