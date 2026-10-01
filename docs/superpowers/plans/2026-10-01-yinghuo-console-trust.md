# Console Trust Surface + Smoke-All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plan status, role send-gates, and unhealthy peers obvious on the Yinghuo console, and add `smoke-all.sh` to regress the near-term stack.

**Architecture:** Display-first changes inside existing `console.page.ts` (no layout redesign). Plan reload uses existing `POST /api/plan/reload` (empty body = disk). Pure format helpers live in a small Node module for unit tests; the page embeds equivalent client JS. Smoke script chains unit tests and optional live scripts.

**Tech Stack:** TypeScript, Nest relay console HTML string, bash, `node --test` / npm workspaces.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-01-yinghuo-console-trust-design.md`
- Do NOT redesign mast/nav/card layout; only extend existing overview / ops / connections blocks
- Plan reload button: `POST /api/plan/reload` with **no body** (disk only)
- Failure copy must state previous plan remains active (zh + en)
- Smoke default: unit always; live scripts only when `SMOKE_LIVE=1`; MCP probe non-strict unless `SMOKE_STRICT=1`
- Do not git commit or push unless the user explicitly asks
- Respond to the user in 中文 when handing back

## File map

| Path | Responsibility |
|------|----------------|
| `apps/relay/src/console/console-trust-format.ts` | Pure helpers: short version, unhealthy line, plan failure banner text |
| `apps/relay/src/console/console-trust-format.test.ts` | Unit tests for helpers |
| `apps/relay/src/console/console.page.ts` | DOM, i18n, applyStatus, reload click, send-gate hint, unhealthy list |
| `apps/relay/src/console/console.page.test.ts` | `buildConsoleHtml` contract: required ids + i18n keys |
| `apps/relay/scripts/smoke-all.sh` | Aggregated smoke |
| `apps/relay/package.json` | `"smoke"` script |
| `package.json` (root) | `"smoke"` → relay workspace |
| `README.md` | One line on console trust + smoke |
| `docs/todo.md` | Check console + smoke items |

---

### Task 1: Format helpers (TDD)

**Files:**
- Create: `apps/relay/src/console/console-trust-format.ts`
- Create: `apps/relay/src/console/console-trust-format.test.ts`

**Interfaces:**
- Produces:
  - `shortPlanVersion(version: string, maxLen?: number): string`
  - `formatUnhealthyLine(u: { id: string; remainMs?: number }): string` → e.g. `Near · 5s`
  - `planKeepOldMessage(locale: 'zh' | 'en'): string`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatUnhealthyLine,
  planKeepOldMessage,
  shortPlanVersion,
} from './console-trust-format.ts';

test('shortPlanVersion truncates long hashes', () => {
  assert.equal(shortPlanVersion('abcdefghijklmnop', 12), 'abcdefghijkl');
  assert.equal(shortPlanVersion('abcd', 12), 'abcd');
  assert.equal(shortPlanVersion('', 12), '—');
});

test('formatUnhealthyLine includes id and remain seconds', () => {
  assert.equal(formatUnhealthyLine({ id: 'Near', remainMs: 4500 }), 'Near · 5s');
  assert.equal(formatUnhealthyLine({ id: 'Alt' }), 'Alt');
});

test('planKeepOldMessage bilingual', () => {
  assert.match(planKeepOldMessage('zh'), /旧计划/);
  assert.match(planKeepOldMessage('en'), /previous plan/i);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/relay && node --import tsx --test src/console/console-trust-format.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement helpers**

```ts
export function shortPlanVersion(version: string, maxLen = 12): string {
  if (!version) return '—';
  return version.length <= maxLen ? version : version.slice(0, maxLen);
}

export function formatUnhealthyLine(u: { id: string; remainMs?: number }): string {
  if (u.remainMs == null || Number.isNaN(u.remainMs)) return u.id;
  const sec = Math.ceil(u.remainMs / 1000);
  return `${u.id} · ${sec}s`;
}

export function planKeepOldMessage(locale: 'zh' | 'en'): string {
  return locale === 'zh'
    ? '校验失败，仍在用旧计划'
    : 'Validation failed; previous plan remains active';
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd apps/relay && node --import tsx --test src/console/console-trust-format.test.ts`  
Expected: PASS

---

### Task 2: Console trust surface

**Files:**
- Modify: `apps/relay/src/console/console.page.ts`
- Create: `apps/relay/src/console/console.page.test.ts`
- Consumes: helpers from Task 1 (import in Node tests; **mirror** `shortPlanVersion` / `formatUnhealthyLine` / keep-old strings in the embedded browser script — keep wording identical to `planKeepOldMessage`)

**DOM / i18n to add:**

Replace single-line plan kv with a block inside the overview node-info card (after existing plan row or replacing `#ov-plan`):

```html
<div class="k" data-i18n="planMeta">接触计划</div>
<div class="v plan-trust" id="ov-plan-block">
  <div class="plan-row"><span class="mono" id="ov-plan-ver">—</span>
    <span class="status-chip muted" id="ov-plan-ok">—</span>
    <span class="faint" id="ov-plan-src">—</span></div>
  <div class="plan-row faint mono" id="ov-plan-path">—</div>
  <div class="plan-row faint" id="ov-plan-watch">—</div>
  <div class="plan-banner" id="ov-plan-banner" hidden></div>
  <button type="button" class="secondary" id="btn-plan-reload" data-i18n="planReload">从磁盘重载</button>
</div>
```

Ops send area — after `#btn-send`:

```html
<p class="hint send-gate" id="send-gate-hint" hidden></p>
```

CSS (minimal): `.plan-trust .plan-row { margin: 0.15rem 0; }`, `.plan-banner { color: var(--warn); font-size: 0.85rem; margin: 0.35rem 0; }`, `.send-gate { color: var(--warn); }`, chip warn already exists or add `.status-chip.warn`.

i18n keys (zh + en): `planMeta`, `planReload`, `planOk`, `planBad`, `planWatchOn`, `planWatchOff`, `planKeepOld`, `sendDisabledDetail` (e.g. zh: `当前角色（{role}）不可注入业务报文`), `unhealthyRemain` template optional if using helper string directly.

**JS behavior:**

1. `applyStatus(s)`:
   - Fill plan fields from `s.plan`; `ov-plan-ok` chip class `ok` vs `warn` from `p.ok`.
   - If `p.ok === false`: show `#ov-plan-banner` with `t('planKeepOld')` + optional `p.lastError`.
   - Else hide banner (unless a just-failed reload set a session flag — clear on success).
   - Role chip: if `!canInject` → `status-chip warn`, else `muted`; title = mission + routeBias.
   - `#send-gate-hint`: if `!canInject`, `hidden=false`, text = `t('sendDisabledDetail').replace('{role}', s.missionRole || s.role)`; else hide. Keep button disabled.

2. `#btn-plan-reload` click:
   - `POST /api/plan/reload` (no body), `Content-Type` optional.
   - On JSON `ok: true` or success shape used by controller: toast / banner success, `refresh()`.
   - On failure: show banner with `planKeepOld` + `errors.join`; do not claim plan replaced.

Check controller response shape before wiring:

```bash
# from repo knowledge: ContactPlanReloadService returns
# { ok: true, version, source } | { ok: false, errors: string[], source }
```

3. Unhealthy render: replace join-with-comma with line breaks or ` · `-separated `formatUnhealthyLine` equivalents (`id · Ns`).

- [ ] **Step 1: Write `console.page.test.ts` contract tests (fail until DOM exists)**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConsoleHtml } from './console.page.ts';

test('console html exposes plan trust + send gate + unhealthy host', () => {
  const html = buildConsoleHtml({
    nodeId: 'Earth',
    port: 3101,
    peerUrl: 'http://127.0.0.1:3102/',
  });
  for (const id of [
    'ov-plan-block', 'ov-plan-ver', 'ov-plan-ok', 'ov-plan-src',
    'ov-plan-path', 'ov-plan-watch', 'ov-plan-banner', 'btn-plan-reload',
    'send-gate-hint', 'cn-unhealthy',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const key of ['planReload', 'planKeepOld', 'sendDisabledDetail']) {
    assert.match(html, new RegExp(key));
  }
});
```

- [ ] **Step 2: Run contract test — expect FAIL**

Run: `cd apps/relay && node --import tsx --test src/console/console.page.test.ts`

- [ ] **Step 3: Implement DOM, CSS, i18n, applyStatus, reload handler, unhealthy lines in `console.page.ts`**

Remove obsolete single `#ov-plan` text assignment (or keep hidden compat id unused — prefer delete to avoid drift).

- [ ] **Step 4: Run console + format tests — expect PASS**

Run: `cd apps/relay && node --import tsx --test src/console/console-trust-format.test.ts src/console/console.page.test.ts`

- [ ] **Step 5: Quick manual sanity (if relays up)** — open `http://127.0.0.1:3101/`, confirm plan block + reload; optional skip if no daemon.

---

### Task 3: smoke-all + docs

**Files:**
- Create: `apps/relay/scripts/smoke-all.sh` (mode `0755`)
- Modify: `apps/relay/package.json` — add `"smoke": "bash scripts/smoke-all.sh"`
- Modify: `package.json` (root) — add `"smoke": "npm run smoke -w @yinghuo/relay"`
- Modify: `README.md` — console trust one-liner + smoke command
- Modify: `docs/todo.md` — check 体验／冒烟 items under 近

**Interfaces:**
- Produces: exit 0 on unit success; live optional

- [ ] **Step 1: Write `smoke-all.sh`**

```bash
#!/usr/bin/env bash
# Aggregated Yinghuo near-stack smoke.
# Default: unit tests (relay + mcp).
# SMOKE_LIVE=1: also dual-island + unhealthy-retry (destructive to ports).
# SMOKE_STRICT=1: MCP HTTP probe failure is fatal when probing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

echo "== unit: @yinghuo/relay =="
npm test -w @yinghuo/relay

echo "== unit: @yinghuo/mcp =="
npm test -w @yinghuo/mcp

if [[ "${SMOKE_LIVE:-0}" == "1" ]]; then
  echo "== live: dual-island =="
  bash apps/relay/scripts/dual-island.sh
  echo "== live: unhealthy-retry =="
  bash apps/relay/scripts/unhealthy-retry.sh
fi

probe_mcp() {
  local url="${DTN_RELAY_URL:-http://127.0.0.1:3101}"
  if curl -sf "$url/api/health" >/dev/null 2>&1; then
    echo "== mcp probe against $url =="
    # Minimal: status via relay HTTP (mcp package unit already covered tools)
    curl -sf "$url/api/status" | head -c 200 >/dev/null
    echo "ok: relay reachable for agent path"
    return 0
  fi
  echo "skip: no relay at $url (start daemons or set DTN_RELAY_URL)"
  if [[ "${SMOKE_STRICT:-0}" == "1" ]]; then
    return 1
  fi
  return 0
}

probe_mcp

echo "smoke-all: OK"
```

- [ ] **Step 2: chmod +x; dry run unit path**

Run: `chmod +x apps/relay/scripts/smoke-all.sh && npm run smoke -w @yinghuo/relay`  
Expected: relay + mcp unit PASS; mcp probe skip or ok; exit 0

- [ ] **Step 3: Wire root `package.json` `"smoke"` script**

- [ ] **Step 4: Update README** — under tests / console: mention plan banner + reload button; `npm run smoke` / `SMOKE_LIVE=1 npm run smoke`

- [ ] **Step 5: Update `docs/todo.md`** — mark console引导 and 一键冒烟 as done (or move to 已交付摘要)

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Plan version/source/ok/path/watch/error | Task 2 |
| Keep-old banner on failure | Task 1 copy + Task 2 |
| Disk reload button | Task 2 |
| Role warn chip + send reason | Task 2 |
| Unhealthy readable lines | Task 1 + Task 2 |
| i18n zh/en | Task 2 |
| smoke-all + package scripts | Task 3 |
| README + todo | Task 3 |
| No JSON editor / no layout redesign | Global Constraints |

## Self-review notes

- No placeholders; helper signatures match Task 2 consumption.
- Commit steps omitted (user must request commits).
- Live smoke opt-in avoids CI / empty-port false reds.
