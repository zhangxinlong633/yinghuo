#!/usr/bin/env bash
# Start a 10-node graph-mode cluster, wait for gossip, send node0 → node9.
#
# node0 is the bootstrap (no BOOTSTRAP_URL). node1..node9 join it.
# Coordinates: node0 at x=0, node9 at x=100, node1..node8 at negative x.
# Greedy routing only forwards to a strictly closer direct neighbor, and a
# joiner's only peer URL is the bootstrap. Nodes behind node0 are culled, so
# node0 forwards straight to node9. A line of increasing x would pick the
# lexicographically first closer peer (node1), which cannot forward onward.
#
# Env:
#   BASE_PORT          first port (default 3320); nodes use BASE_PORT+i
#   JOIN_TIMEOUT_SEC   inbox wait after send (default 120)
#   JOIN_KEEP=1        leave daemons running (default: kill on exit)
#   NODE_COUNT         default 10 (last node is the destination)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELAY_DIR="$ROOT/apps/relay"
BASE_PORT="${BASE_PORT:-3320}"
TIMEOUT="${JOIN_TIMEOUT_SEC:-120}"
NODE_COUNT="${NODE_COUNT:-10}"
LAST=$((NODE_COUNT - 1))
DATA_ROOT="$ROOT/data/graph-join"
LOG_DIR="$DATA_ROOT/logs"
PAYLOAD="join-cluster-$(date +%s)-$$"

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

coord_x() {
  local i="$1"
  if [[ "$i" -eq 0 ]]; then
    echo 0
  elif [[ "$i" -eq "$LAST" ]]; then
    echo 100
  else
    echo $(( -10 * i ))
  fi
}

url_of() {
  echo "http://127.0.0.1:$((BASE_PORT + $1))"
}

wait_until() {
  local label="$1"
  local seconds="$2"
  local url="$3"
  local expr="$4"
  local extra="${5:-}"
  local deadline=$((SECONDS + seconds))
  while (( SECONDS < deadline )); do
    if node --input-type=module -e '
      let res;
      try {
        res = await fetch(process.argv[1]);
      } catch {
        process.exit(1);
      }
      if (!res.ok) process.exit(1);
      const body = await res.json();
      const extra = process.argv[2] ?? "";
      if (eval(process.argv[3])) process.exit(0);
      process.exit(2);
    ' "$url" "$extra" "$expr" 2>/dev/null; then
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

start_node() {
  local i="$1"
  local port=$((BASE_PORT + i))
  local id="node${i}"
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
    export EID="ipn:$((100 + i)).1"
    export PEER_URL="http://127.0.0.1:${port}"
    export NODE_X="$(coord_x "$i")"
    export NODE_Y=0
    export DATA_DIR="$dir"
    if [[ "$i" -eq 0 ]]; then
      unset BOOTSTRAP_URL
    else
      export BOOTSTRAP_URL="http://127.0.0.1:${BASE_PORT}"
    fi
    exec "$tsx" src/main.ts
  ) >"$log" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  echo "started $id pid=$pid port=$port x=$(coord_x "$i") log=$log"
}

echo "graph-join cluster: ${NODE_COUNT} nodes, ports ${BASE_PORT}..$((BASE_PORT + LAST)), timeout ${TIMEOUT}s"
mkdir -p "$LOG_DIR"
for ((i = 0; i < NODE_COUNT; i++)); do
  free_port $((BASE_PORT + i))
done
rm -rf "$DATA_ROOT"
mkdir -p "$LOG_DIR"

start_node 0
wait_until "node0 health" 40 "$(url_of 0)/api/health" 'body.ok === true'

for ((i = 1; i < NODE_COUNT; i++)); do
  start_node "$i"
  wait_until "node${i} joined bootstrap" 40 "$(url_of "$i")/api/graph" 'body.stats && body.stats.peerCount >= 1'
done

wait_until "node0 knows every node" 40 "$(url_of 0)/api/graph" "body.stats && body.stats.nodeCount >= ${NODE_COUNT}"
# Gossip copies the sender direct flag, so kind stays "direct". hopCount > 0
# (or a full node list on a joiner) is the signal that a summary arrived.
wait_until "gossip reached node1" 45 "$(url_of 1)/api/graph" "body.stats && body.stats.nodeCount >= ${NODE_COUNT} && (body.edges || []).some((e) => e.hopCount > 0)"
wait_until "node0 next hop is node${LAST}" 20 "$(url_of 0)/api/graph/route?dst=node${LAST}" 'body.nextHop === "node'"${LAST}"'"'

echo "sending payload=${PAYLOAD} node0 → node${LAST}"
node --input-type=module -e '
  const res = await fetch(process.argv[1], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dst: process.argv[2], payload: process.argv[3], ttlMs: 180000 }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body));
  if (!res.ok || body.ok !== true) process.exit(1);
' "$(url_of 0)/api/send" "node${LAST}" "$PAYLOAD"

wait_until "node${LAST} inbox" "$TIMEOUT" "$(url_of "$LAST")/api/inbox" '(body.messages || []).some((m) => m.payload === extra)' "$PAYLOAD"

echo "delivered ${PAYLOAD} to node${LAST}"
echo "RESULT=PASS payload=${PAYLOAD} ports=${BASE_PORT}-$((BASE_PORT + LAST))"
