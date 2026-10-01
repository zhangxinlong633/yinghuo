# Yinghuo MCP（stdio）— Agent 一等调用入口

日期：2026-10-01

背景：创新中心从 GUI 转向协议／Agent 层。Yinghuo 已有 headless relay（HTTP）＋ CLI／SDK＋人类控制台；缺的是 **Agent 可发现、可调用的标准工具面**。本变更新增独立 MCP server（stdio），把现有 HTTP 运维能力暴露给 Cursor／Claude 等本机 Agent；远程 HTTP／SSE MCP 与鉴权留待后续。

## 目标

- 本机 Agent 可通过 MCP 完成最小运维闭环，而无需解析控制台 HTML。
- 传输：stdio；配置一行即可挂进 Cursor `mcpServers`。
- 工具面覆盖：状态、接触／计划、图与选路试算、发束、收件箱、计划热更新。
- 实现为独立 workspace 包 `@yinghuo/mcp`，不绑死 Nest 进程生命周期。
- 工具描述清楚区分只读与会改状态的操作。

## 非目标

- 不做 HTTP／SSE MCP、OAuth／mTLS、多租户权限模型。
- 不把控制台改成「动态生成 UI」；GUI 仍是人类监督面。
- 不新增业务语义（路由算法、角色策略等仍由 relay 负责）；MCP 只做薄适配。
- 不强制依赖 `@yinghuo/sdk` 的完整 API 面（可用 `fetch` 直打 HTTP；若 SDK 已有等价方法可复用）。
- 不做多节点会话池／自动发现集群；v1 一次只指向一个 `DTN_RELAY_URL`。

## 架构

```
Agent (Cursor / Claude)
    │ stdio MCP
    ▼
@yinghuo/mcp  (packages/yinghuo-mcp)
    │ HTTP (fetch)
    ▼
relay daemon  (/api/status|/api/contacts|/api/plan|/api/graph|/api/send|/api/inbox|/api/recv|…)
    │
    ▼
人类 GUI（控制台）— 审批／审计／看板，非 Agent 主路径
```

环境变量：

| 变量 | 含义 | 默认 |
|------|------|------|
| `DTN_RELAY_URL` 或 `YINGHUO_RELAY_URL` | 目标 relay 根 URL | `http://127.0.0.1:3101` |
| （可选）超时 | 请求超时 ms | 实现时定合理默认（如 10s） |

## 工具清单（v1）

命名前缀 `yinghuo_`，避免与其它 MCP 冲突。

| 工具 | 只读？ | 映射 | 说明 |
|------|:------:|------|------|
| `yinghuo_status` | ✓ | `GET /api/status` | 角色能力、计划元数据、接触、存储深度 |
| `yinghuo_contacts` | ✓ | `GET /api/contacts` | 窗口／links／plan |
| `yinghuo_plan` | ✓ | `GET /api/plan` | 版本／source／lastError |
| `yinghuo_plan_reload` | 改 | `POST /api/plan/reload` | 可选 body；失败返回 errors，不假装成功 |
| `yinghuo_graph` | ✓ | `GET /api/graph` | 局部图、簇、unhealthy |
| `yinghuo_graph_route` | ✓ | `GET /api/graph/route?dst=` | 必填 `dst` |
| `yinghuo_send` | 改 | `POST /api/send` | `{ dst, payload, ttlMs? }`；业务字段原样返回 |
| `yinghuo_inbox` | 视参 | `GET /api/inbox` 或 `GET /api/recv?clear=` | `clear` 默认 false |

错误：HTTP 非 2xx 时工具返回可读错误文本（含 status 与 body 摘要），不吞掉校验失败（如 plan reload 400）。

## 包与工程

- 路径：`packages/yinghuo-mcp`
- npm 名：`@yinghuo/mcp`
- 依赖：`@modelcontextprotocol/sdk`（官方）、Node ≥18
- 入口：`tsx`／编译后的 `bin`（如 `yinghuo-mcp`）
- 根 `package.json` workspaces 已含 `packages/*`，无需改结构
- 文档：根 README 增加 Cursor MCP 配置示例；可选在 `docs/todo.md`「中」或「近」记一条 MCP 台账（实现时勾选）

Cursor 配置示例（文档用）：

```json
{
  "mcpServers": {
    "yinghuo": {
      "command": "npx",
      "args": ["tsx", "packages/yinghuo-mcp/src/main.ts"],
      "env": { "DTN_RELAY_URL": "http://127.0.0.1:3101" },
      "cwd": "/path/to/yinghuo"
    }
  }
}
```

（实现时可改为 `node dist/...` 或 `npm run mcp -w @yinghuo/mcp`。）

## 测试与验收

- 单元：工具参数 schema／URL 拼装／错误映射（可用 mock `fetch`）。
- 手工：起 Earth relay → Cursor 调 `yinghuo_status`／`yinghuo_send`／`yinghuo_inbox`。
- 验收：未起 daemon 时工具返回连接失败而非崩溃；plan reload 坏计划时返回 errors 且文案可读。

## 后续（非本切片）

- HTTP／SSE MCP（常驻运维 Agent）
- 按工具声明的细粒度权限／审计日志
- 多 `DTN_RELAY_URL` 或节点选择参数
- 与角色策略对齐的「Agent 代表谁」委托模型

## 决策记录

- 第一消费者：本机开发 Agent；远程形态以后加。
- 工具面：最小运维集（非只读、非全量 HTTP）。
- 形态：独立包 `@yinghuo/mcp`，stdio + HTTP 适配，而非塞进 relay／CLI。
