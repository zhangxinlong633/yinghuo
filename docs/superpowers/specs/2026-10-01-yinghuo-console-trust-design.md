# 控制台信任面补齐 ＋ 一键冒烟

日期：2026-10-01

背景：近程已交付绝对窗、多岛／unhealthy、角色策略、计划热更新与本机 MCP。这些能力在 HTTP／脚本侧可用，但控制台仍多为碎片展示（单行 plan、muted role chip、简略 unhealthy）。人类监督面应把「计划是否生效」「为何不能发」「谁不健康」说清楚。本变更采用**展示优先**方案：不改布局骨架，不新开运维编辑器；并增加一键冒烟脚本防回退。

## 目标

- 控制台清晰展示 `status.plan`（版本、来源、校验状态、路径、监视开关、失败原因）。
- 热更失败时明确提示：**校验失败，仍在用旧计划**；提供「从磁盘重载」按钮，调用已有 `POST /api/plan/reload`。
- 角色禁发／选路偏好在顶栏与操作页发送区可读（含中英 i18n）。
- 连接页 unhealthy／弱连通簇说明更可读（不重做 SVG 布局）。
- 一键冒烟脚本汇总核心验收路径，失败以非零退出码结束。

## 非目标

- 计划 JSON 在线编辑、任意 body 热更 UI。
- 远程 MCP、鉴权、多租户。
- 任务时钟／历元、bandwidth 真实限速及其 UI。
- 整页视觉换肤或新仪表盘布局。
- 在控制台内嵌 join／peer 表单（仍可用 API／脚本）。

## 架构

```
人类浏览器
    │ GET /
    ▼
console.page.ts（纯前端；轮询 /api/status|/api/graph|/api/contacts）
    │ POST /api/plan/reload（仅「从磁盘重载」）
    ▼
relay（ContactPlanReloadService + role-policy + GraphSnapshot）
```

冒烟：

```
npm run smoke  →  apps/relay/scripts/smoke-all.sh
    ├─ unit（relay + mcp，可按环境跳过 live）
    ├─ dual-island / unhealthy 脚本短检（进程可起时）
    └─ mcp client 探测（relay 已起或脚本自起最小实例）
```

## 控制台行为

### 计划状态

数据源：`GET /api/status` 的 `plan`（与 `GET /api/plan` 同形：`PlanStatus`）。

展示字段：

| 字段 | UI |
|------|-----|
| `version` | 短展示（如前 8–12 字符）＋完整 title |
| `source` | `boot` / `watch` / `http` |
| `ok` | 成功 chip / 失败 warn |
| `path` | 路径 mono |
| `watchEnabled` | 开／关 |
| `lastError` | 仅 `ok=false` 或最近失败时显示 |

失败条文案（中／英）：明确「校验失败，仍在用旧计划／Validation failed; previous plan remains active」。

交互：

- 按钮「从磁盘重载」→ `POST /api/plan/reload`（无 body，等同磁盘重读）。
- 成功：条内短暂成功提示，再刷新 status。
- 失败：展示响应 `errors`（或 `plan.lastError`），并保持「旧计划仍生效」说明。
- 不在此轮做上传 JSON／编辑器。

放置：概览「节点信息」卡片内扩展 plan 区块（替换单行 `ov-plan`），避免新导航页。

### 角色与禁发

已有：`capabilities.canInject` 禁用发送按钮＋ `sendDisabledRole` title。

加强：

- 顶栏 `tb-role`：`canInject=false` 时用 warn chip（非仅 muted）；title 含 mission ＋ routeBias。
- 操作页发送区：禁发时在按钮旁／下方显示可见原因文案（不只 title），含 mission 角色名。
- `routeBias`／capabilities 文案保持概览 kv，必要时 i18n 键补全。

### 图与健康

- 保留 `componentId` 描边色与簇图例。
- `cn-unhealthy`：无项 → 中性一句；有项 → 逐行「nodeId · 简短原因／年龄」（字段以 GraphSnapshot `unhealthy` 现有结构为准，缺省则仅 nodeId）。
- 不改 SVG 力导／布局算法。

### i18n

新增／补齐中英键：计划标题、重载按钮、失败仍用旧计划、禁发原因增强、unhealthy 行模板等。现有 `I18N` 对象扩展即可。

## 冒烟脚本

路径：`apps/relay/scripts/smoke-all.sh`。

约定：

1. 仓库根或 `apps/relay` 下均可调用；脚本自行 `cd` 到合适目录。
2. 默认跑：`@yinghuo/relay` 与 `@yinghuo/mcp` 的 unit test。
3. 若端口空闲或显式 `SMOKE_LIVE=1`：串短检 dual-island／unhealthy（超时与现有脚本一致或更短）；失败即停。
4. MCP：对已运行或脚本拉起的 relay 做一次最小 client 调用（如 status）；不可用则跳过并打印 skip（或在 `SMOKE_STRICT=1` 时失败——默认非 strict，避免本机无 daemon 时误红）。
5. `apps/relay/package.json` 增加 `"smoke": "bash scripts/smoke-all.sh"`；根 README 一句指向。
6. 退出码：任一步失败 → 非 0。

## 文档

- `docs/todo.md`：勾选「控制台引导」「一键冒烟」。
- `README.md`：控制台能力一句 ＋ `npm run smoke`（或 workspace 等价命令）。

## 测试与验收

- 手动：坏计划触发 reload → 页上见错误且旧计划生效说明；好计划 reload → ok／version 更新。
- 手动：`ROLE` 禁发角色 → 发送区可见原因，顶栏 warn。
- 手动：制造 unhealthy 邻居 → 连接页列表可读。
- `npm run smoke`（relay 包）在干净仓库 unit 路径下通过。

## 风险

- 控制台为单文件 HTML 字符串，改动易冲突；保持最小 DOM／JS 增量。
- 冒烟 live 依赖端口与本机进程；默认以 unit 为主、live 可选，避免 CI／本机无 daemon 误伤。
