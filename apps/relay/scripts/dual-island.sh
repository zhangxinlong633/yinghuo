#!/usr/bin/env bash
# Dual-island graph smoke: two bootstrap islands grow in isolation, then an
# optional bridge joins both so one local view merges into a single component.
#
# Topology (ports BASE_PORT..BASE_PORT+4):
#   a0 (bootstrap A)  ← a1
#   b0 (bootstrap B)  ← b1
#   bridge            ← joins a0 at start; if BRIDGE=1, also POST /api/graph/join → b0
#
# Env:
#   BASE_PORT          default 3340
#   BRIDGE=1           after islands settle, bridge joins b0 and wait for merge
#   JOIN_KEEP=1        leave daemons running
#   JOIN_TIMEOUT_SEC   wait budget for merge (default 60)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELAY_DIR="$ROOT/apps/relay"
BASE_PORT="${BASE_PORT:-3340}"
TIMEOUT="${JOIN_TIMEOUT_SEC:-60}"
DATA_ROOT="$ROOT/data/dual-island"
LOG_DIR="$DATA_ROOT/logs"
BRIDGE_MODE="${BRIDGE:-0}"

PIDS=()

cleanup() {
  local pid
  if [[ "${JOIN_KEEP:-0}" == 1 ]]; then
    echo "JOIN_KEEP=1 — leaving ${#PIDS[@]} relay processes running"
    return 0
  fi
  for pid in "${PIDS[@]+"${PIDS[@]}"}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait "${PIDS[@]+"${PIDS[@]}"}" 2>/dev/null || true
}
trap cleanup EXIT

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "stopping listeners on :${port} (${pids//$'\n'/ })"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
  fi
}

wait_until() {
  local label="$1"
  local seconds="$2"
  local url="$3"
  local expr="$4"
  local deadline=$((SECONDS + seconds))
  while (( SECONDS < deadline )); do
    if node --input-type=module -e '
      let res;
      try { res = await fetch(process.argv[1]); } catch { process.exit(1); }
      if (!res.ok) process.exit(1);
      const body = await res.json();
      if (eval(process.argv[2])) process.exit(0);
      process.exit(2);
    ' "$url" "$expr" 2>/dev/null; then
      echo "ok: $label"
      return 0
    fi
    sleep 0.4
  done
  echo "timeout: $label" >&2
  node --input-type=module -e '
    try {
      const res = await fetch(process.argv[1]);
      console.error(await res.text());
    } catch (err) {
      console.error(String(err));
    }
  ' "$url" >&2 || true
  return 1
}

# id port x y bootstrap_url_or_empty
start_named() {
  local id="$1"
  local port="$2"
  local x="$3"
  local y="$4"
  local bootstrap="${5:-}"
  local dir="$DATA_ROOT/$id"
  local log="$LOG_DIR/${id}.log"
  local tsx="$ROOT/node_modules/.bin/tsx"
  mkdir -p "$dir" "$LOG_DIR"
  if [[ ! -x "$tsx" ]]; then
    echo "missing $tsx — run npm install at the repo root" >&2
    exit 1
  fi
  (
    cd "$RELAY_DIR"
    export DTN_GRAPH_MODE=1
    export NODE_ID="$id"
    export PORT="$port"
    export EID="ipn:$((200 + port % 100)).1"
    export PEER_URL="http://127.0.0.1:${port}"
    export NODE_X="$x"
    export NODE_Y="$y"
    export DATA_DIR="$dir"
    if [[ -n "$bootstrap" ]]; then
      export BOOTSTRAP_URL="$bootstrap"
    else
      unset BOOTSTRAP_URL
    fi
    exec "$tsx" src/main.ts
  ) >"$log" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  echo "started $id pid=$pid port=$port bootstrap=${bootstrap:-none} log=$log"
}

A0_PORT=$BASE_PORT
A1_PORT=$((BASE_PORT + 1))
B0_PORT=$((BASE_PORT + 2))
B1_PORT=$((BASE_PORT + 3))
BR_PORT=$((BASE_PORT + 4))

A0="http://127.0.0.1:${A0_PORT}"
A1="http://127.0.0.1:${A1_PORT}"
B0="http://127.0.0.1:${B0_PORT}"
B1="http://127.0.0.1:${B1_PORT}"
BR="http://127.0.0.1:${BR_PORT}"

echo "dual-island: ports ${A0_PORT}..${BR_PORT} BRIDGE=${BRIDGE_MODE}"
mkdir -p "$LOG_DIR"
for p in "$A0_PORT" "$A1_PORT" "$B0_PORT" "$B1_PORT" "$BR_PORT"; do
  free_port "$p"
done
rm -rf "$DATA_ROOT"
mkdir -p "$LOG_DIR"

# Island A
start_named a0 "$A0_PORT" 0 0
wait_until "a0 health" 40 "$A0/api/health" 'body.ok === true'
start_named a1 "$A1_PORT" 10 0 "$A0"
wait_until "a1 joined a0" 40 "$A1/api/graph" 'body.stats && body.stats.peerCount >= 1'

# Island B
start_named b0 "$B0_PORT" 100 0
wait_until "b0 health" 40 "$B0/api/health" 'body.ok === true'
start_named b1 "$B1_PORT" 110 0 "$B0"
wait_until "b1 joined b0" 40 "$B1/api/graph" 'body.stats && body.stats.peerCount >= 1'

# Bridge seeds on A only
start_named bridge "$BR_PORT" 50 20 "$A0"
wait_until "bridge joined a0" 40 "$BR/api/graph" 'body.stats && body.stats.peerCount >= 1'

# Isolation: A must not know B; B must not know A
wait_until "a0 island only" 30 "$A0/api/graph" '(function(){ const ids=(body.nodes||[]).map((n)=>n.id); return body.stats.componentCount===1 && ids.every((id)=>id==="a0"||id==="a1"||id==="bridge") && !ids.includes("b0") && !ids.includes("b1"); })()'
wait_until "b0 island only" 30 "$B0/api/graph" '(function(){ const ids=(body.nodes||[]).map((n)=>n.id); return body.stats.componentCount===1 && ids.every((id)=>id==="b0"||id==="b1") && !ids.includes("a0") && !ids.includes("a1") && !ids.includes("bridge"); })()'

echo "ok: dual islands isolated (weak components local to each bootstrap)"

if [[ "$BRIDGE_MODE" == "1" ]]; then
  echo "bridge joining b0 via POST /api/graph/join"
  node --input-type=module -e '
    const res = await fetch(process.argv[1] + "/api/graph/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: process.argv[2] }),
    });
    const body = await res.json();
    console.log(JSON.stringify(body));
    if (!res.ok || body.ok !== true) process.exit(1);
  ' "$BR" "$B0"

  wait_until "bridge sees both islands" "$TIMEOUT" "$BR/api/graph" '(function(){ const ids=new Set((body.nodes||[]).map((n)=>n.id)); return ids.has("a0") && ids.has("a1") && ids.has("b0") && ids.has("bridge") && body.stats.componentCount===1; })()'
  wait_until "a0 learns b0 via bridge gossip" "$TIMEOUT" "$A0/api/graph" '(function(){ const ids=new Set((body.nodes||[]).map((n)=>n.id)); return ids.has("b0") || ids.has("b1"); })()'
  echo "ok: bridge merged islands (componentCount=1 on bridge)"
fi

echo "RESULT=PASS dual-island BRIDGE=${BRIDGE_MODE} ports=${A0_PORT}-${BR_PORT}"
