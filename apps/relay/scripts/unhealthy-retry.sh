#!/usr/bin/env bash
# Unhealthy neighbor failover smoke (graph mode).
#
# Topology (BASE_PORT..+3):
#   dst  (bootstrap, x=100)
#   alt  joins dst (x=40)   — lexicographically preferred next hop from src
#   near joins dst (x=80)
#   src  joins alt, then POST /api/graph/join → near
#
# Flow: assert route src→dst = alt; kill alt; send; wait unhealthy; route = near;
#       deliver to dst; wait DTN_UNHEALTHY_MS then unhealthy clears.
#
# Env:
#   BASE_PORT=3350
#   DTN_UNHEALTHY_MS=4000   (script default for fast recovery check)
#   JOIN_KEEP=1
#   JOIN_TIMEOUT_SEC=60
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELAY_DIR="$ROOT/apps/relay"
BASE_PORT="${BASE_PORT:-3350}"
TIMEOUT="${JOIN_TIMEOUT_SEC:-60}"
UNHEALTHY_MS="${DTN_UNHEALTHY_MS:-15000}"
DATA_ROOT="$ROOT/data/unhealthy-retry"
LOG_DIR="$DATA_ROOT/logs"
PAYLOAD="unhealthy-$(date +%s)-$$"

PIDS=()
ALT_PID=""

cleanup() {
  if [[ "${JOIN_KEEP:-0}" == 1 ]]; then
    echo "JOIN_KEEP=1 — leaving processes running"
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
    sleep 0.35
  done
  echo "timeout: $label" >&2
  node --input-type=module -e '
    try {
      const res = await fetch(process.argv[1]);
      console.error(await res.text());
    } catch (err) { console.error(String(err)); }
  ' "$url" >&2 || true
  return 1
}

# id port x y bootstrap_or_empty [role]
start_named() {
  local id="$1"
  local port="$2"
  local x="$3"
  local y="$4"
  local bootstrap="${5:-}"
  local role="${6:-endpoint}"
  local dir="$DATA_ROOT/$id"
  local log="$LOG_DIR/${id}.log"
  local tsx="$ROOT/node_modules/.bin/tsx"
  mkdir -p "$dir" "$LOG_DIR"
  (
    cd "$RELAY_DIR"
    export DTN_GRAPH_MODE=1
    export DTN_UNHEALTHY_MS="$UNHEALTHY_MS"
    export NODE_ID="$id"
    export PORT="$port"
    export EID="ipn:$((300 + port % 100)).1"
    export PEER_URL="http://127.0.0.1:${port}"
    export NODE_X="$x"
    export NODE_Y="$y"
    export DATA_DIR="$dir"
    export ROLE="$role"
    if [[ -n "$bootstrap" ]]; then
      export BOOTSTRAP_URL="$bootstrap"
    else
      unset BOOTSTRAP_URL
    fi
    exec "$tsx" src/main.ts
  ) >"$log" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  if [[ "$id" == "alt" ]]; then
    ALT_PID="$pid"
  fi
  echo "started $id pid=$pid port=$port x=$x role=$role"
}

DST_PORT=$BASE_PORT
ALT_PORT=$((BASE_PORT + 1))
NEAR_PORT=$((BASE_PORT + 2))
SRC_PORT=$((BASE_PORT + 3))
DST="http://127.0.0.1:${DST_PORT}"
ALT="http://127.0.0.1:${ALT_PORT}"
NEAR="http://127.0.0.1:${NEAR_PORT}"
SRC="http://127.0.0.1:${SRC_PORT}"

echo "unhealthy-retry: ports ${DST_PORT}..${SRC_PORT} UNHEALTHY_MS=${UNHEALTHY_MS}"
for p in "$DST_PORT" "$ALT_PORT" "$NEAR_PORT" "$SRC_PORT"; do free_port "$p"; done
rm -rf "$DATA_ROOT"
mkdir -p "$LOG_DIR"

start_named dst "$DST_PORT" 100 0 "" endpoint
wait_until "dst health" 40 "$DST/api/health" 'body.ok === true'

start_named alt "$ALT_PORT" 40 0 "$DST" relay
wait_until "alt joined" 40 "$ALT/api/graph" 'body.stats && body.stats.peerCount >= 1'

start_named near "$NEAR_PORT" 80 0 "$DST" relay
wait_until "near joined" 40 "$NEAR/api/graph" 'body.stats && body.stats.peerCount >= 1'

start_named src "$SRC_PORT" 0 0 "$ALT" endpoint
wait_until "src joined alt" 40 "$SRC/api/graph" 'body.stats && body.stats.peerCount >= 1'

echo "src joining near via /api/graph/join"
node --input-type=module -e '
  const res = await fetch(process.argv[1] + "/api/graph/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: process.argv[2] }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body));
  if (!res.ok || body.ok !== true) process.exit(1);
' "$SRC" "$NEAR"

wait_until "src knows dst" 40 "$SRC/api/graph" '(function(){ const ids=new Set((body.nodes||[]).map(n=>n.id)); return ids.has("dst") && ids.has("alt") && ids.has("near"); })()'
wait_until "src prefers alt" 20 "$SRC/api/graph/route?dst=dst" 'body.nextHop === "alt"'

echo "killing alt pid=$ALT_PID"
kill "$ALT_PID" 2>/dev/null || true
sleep 0.5

echo "sending payload=${PAYLOAD} src → dst (expect fail over alt → near)"
node --input-type=module -e '
  const res = await fetch(process.argv[1] + "/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dst: "dst", payload: process.argv[2], ttlMs: 180000 }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body));
  if (!res.ok || body.ok !== true) process.exit(1);
' "$SRC" "$PAYLOAD"

wait_until "src marks alt unhealthy" 25 "$SRC/api/graph" '(body.unhealthy || []).some((u) => u.id === "alt")'
wait_until "src route failover to near" 25 "$SRC/api/graph/route?dst=dst" 'body.nextHop === "near"'
wait_until "dst inbox delivery" "$TIMEOUT" "$DST/api/inbox" '(body.messages || []).some((m) => m.payload === "'"$PAYLOAD"'")'

echo "waiting for unhealthy window (~${UNHEALTHY_MS}ms) to clear"
wait_until "alt unhealthy cleared" $((UNHEALTHY_MS / 1000 + 8)) "$SRC/api/graph" '!(body.unhealthy || []).some((u) => u.id === "alt")'

echo "RESULT=PASS unhealthy-retry payload=${PAYLOAD} ports=${DST_PORT}-${SRC_PORT}"
