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
    curl -sf -o /dev/null "$url/api/status"
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
