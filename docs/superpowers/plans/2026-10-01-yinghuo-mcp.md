# Yinghuo MCP (stdio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@yinghuo/mcp` — a stdio MCP server that exposes Yinghuo relay HTTP ops tools to local Agents (Cursor).

**Architecture:** Independent workspace package. Tools call `fetch` against `DTN_RELAY_URL` / `YINGHUO_RELAY_URL` (default `http://127.0.0.1:3101`). No Nest coupling. Thin HTTP client + `McpServer` + `StdioServerTransport`.

**Tech Stack:** Node ≥18, TypeScript, `tsx`, `@modelcontextprotocol/sdk`, `zod` (peer of SDK).

## Global Constraints

- Tool names: `yinghuo_status|contacts|plan|plan_reload|graph|graph_route|send|inbox`
- Base URL env: `DTN_RELAY_URL` or `YINGHUO_RELAY_URL`; default `http://127.0.0.1:3101`
- Request timeout default 10s
- stdout reserved for MCP JSON-RPC; log via `console.error` only
- Do not commit unless the user asks
- Spec: `docs/superpowers/specs/2026-10-01-yinghuo-mcp-design.md`

## File map

| Path | Responsibility |
|------|----------------|
| `packages/yinghuo-mcp/package.json` | `@yinghuo/mcp` bin + deps |
| `packages/yinghuo-mcp/tsconfig.json` | TS config |
| `packages/yinghuo-mcp/src/relay-url.ts` | Resolve base URL + DTN_NODE |
| `packages/yinghuo-mcp/src/relay-client.ts` | Typed thin HTTP client |
| `packages/yinghuo-mcp/src/relay-client.test.ts` | URL/error mapping tests |
| `packages/yinghuo-mcp/src/server.ts` | Register MCP tools |
| `packages/yinghuo-mcp/src/main.ts` | stdio entry |
| `package.json` (root) | `mcp` script |
| `README.md` / `docs/todo.md` | Cursor config + todo line |

---

### Task 1: Package scaffold + relay client (TDD)

**Files:**
- Create: `packages/yinghuo-mcp/package.json`
- Create: `packages/yinghuo-mcp/tsconfig.json`
- Create: `packages/yinghuo-mcp/src/relay-url.ts`
- Create: `packages/yinghuo-mcp/src/relay-client.ts`
- Create: `packages/yinghuo-mcp/src/relay-client.test.ts`

**Interfaces:**
- Produces: `resolveRelayUrl(): string`
- Produces: `class RelayHttpClient { get/post JSON; throws RelayHttpError }`

- [ ] **Step 1:** Create package.json

```json
{
  "name": "@yinghuo/mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "bin": { "yinghuo-mcp": "./src/main.ts" },
  "scripts": {
    "start": "tsx src/main.ts",
    "test": "node --import tsx --test src/**/*.test.ts",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2:** Write failing tests for `resolveRelayUrl` and error formatting

- [ ] **Step 3:** Implement `relay-url.ts` + `relay-client.ts` (timeout 10s, strip trailing slash)

- [ ] **Step 4:** `npm install` at repo root; `npm test -w @yinghuo/mcp` → pass

---

### Task 2: MCP server tools + stdio entry

**Files:**
- Create: `packages/yinghuo-mcp/src/server.ts`
- Create: `packages/yinghuo-mcp/src/main.ts`

**Interfaces:**
- Consumes: `RelayHttpClient`, `resolveRelayUrl`
- Produces: `createYinghuoServer(client): McpServer`

- [ ] **Step 1:** Register eight tools with zod schemas; write tools return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }` or `isError: true` on failure

- [ ] **Step 2:** `main.ts` connects `StdioServerTransport`; never `console.log`

- [ ] **Step 3:** Smoke: `echo` / inspector optional; at least `node --import tsx -e "import './src/server.ts'"` loads

---

### Task 3: Docs + root script + todo

**Files:**
- Modify: `package.json` (root) — `"mcp": "npm run start -w @yinghuo/mcp"`
- Modify: `README.md` — MCP section + Cursor JSON
- Modify: `docs/todo.md` — add checked near/mid MCP line under 身份 or new near bullet

- [ ] **Step 1:** Document env + config example from spec
- [ ] **Step 2:** Run `npm test -w @yinghuo/mcp` and `npm test -w @yinghuo/relay` (no regress)

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| stdio MCP package | 1–2 |
| Eight tools | 2 |
| Env URL | 1 |
| Error readability | 1–2 |
| README Cursor config | 3 |
| No auth / no SSE | N/A (omitted) |
