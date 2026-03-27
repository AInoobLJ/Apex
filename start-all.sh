#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# APEX — Start All Services
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# Starts API server, background worker, and dashboard dev server
# with auto-restart on crash, health checks, and port conflict handling.
#
# Usage:
#   ./start-all.sh              (foreground — Ctrl+C to stop all)
#   nohup ./start-all.sh &      (background — survives terminal close)
#
# Logs:
#   /tmp/apex-api.log
#   /tmp/apex-worker.log
#   /tmp/apex-dashboard.log
#   /tmp/apex-all.log           (this script's own log)
#
# To stop: kill the start-all.sh process (it will clean up children)
#   kill $(cat /tmp/apex-all.pid)
#
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$SCRIPT_DIR/apps/api"
DASH_DIR="$SCRIPT_DIR/apps/dashboard"

LOG_DIR="/tmp"
API_LOG="$LOG_DIR/apex-api.log"
WORKER_LOG="$LOG_DIR/apex-worker.log"
DASH_LOG="$LOG_DIR/apex-dashboard.log"
MAIN_LOG="$LOG_DIR/apex-all.log"
PID_FILE="$LOG_DIR/apex-all.pid"

API_PORT=3001
DASH_PORT=5173

COOLDOWN=5
HEALTH_INTERVAL=60   # seconds between API health checks
HEALTH_TIMEOUT=5     # seconds to wait for health response

# PIDs for child processes
API_PID=""
WORKER_PID=""
DASH_PID=""

# ── Logging ──

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [apex] $*" | tee -a "$MAIN_LOG"
}

# ── Port management ──

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    log "Killing existing process(es) on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

# ── Process management ──

start_api() {
  kill_port $API_PORT
  log "Starting API server on port $API_PORT..."
  cd "$API_DIR"
  npx tsx src/server.ts >> "$API_LOG" 2>&1 &
  API_PID=$!
  cd "$SCRIPT_DIR"
  log "API server started (PID: $API_PID)"
}

start_worker() {
  log "Starting worker..."
  cd "$API_DIR"
  npx tsx src/worker.ts >> "$WORKER_LOG" 2>&1 &
  WORKER_PID=$!
  cd "$SCRIPT_DIR"
  log "Worker started (PID: $WORKER_PID)"
}

start_dashboard() {
  kill_port $DASH_PORT
  log "Starting dashboard on port $DASH_PORT..."
  cd "$DASH_DIR"
  npx vite --port $DASH_PORT >> "$DASH_LOG" 2>&1 &
  DASH_PID=$!
  cd "$SCRIPT_DIR"
  log "Dashboard started (PID: $DASH_PID)"
}

# ── Health check ──

check_api_health() {
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" "http://localhost:$API_PORT/api/v1/system/health" 2>/dev/null || echo "000")
  [ "$status" = "200" ]
}

# ── Cleanup ──

cleanup() {
  log "Shutting down all services..."
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true
  [ -n "$DASH_PID" ] && kill "$DASH_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$PID_FILE"
  log "All services stopped."
  exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

# ── Main ──

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " APEX — Starting All Services"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Project: $SCRIPT_DIR"
log "API:     port $API_PORT → $API_LOG"
log "Worker:  → $WORKER_LOG"
log "Dash:    port $DASH_PORT → $DASH_LOG"
log ""

# Save our own PID
echo $$ > "$PID_FILE"

# Kill any stale processes from previous runs
kill_port $API_PORT
kill_port $DASH_PORT
# Kill any existing worker (by name, not port)
pkill -f "tsx src/worker.ts" 2>/dev/null || true
# Kill any existing start-worker.sh (we're replacing it)
pkill -f "start-worker.sh" 2>/dev/null || true
sleep 1

# Start all services
start_api
start_worker
start_dashboard

# Wait for API to come up
log "Waiting for API health check..."
for i in $(seq 1 30); do
  if check_api_health; then
    log "API is healthy ✓"
    break
  fi
  if [ "$i" = "30" ]; then
    log "WARNING: API did not become healthy in 30s"
  fi
  sleep 1
done

log ""
log "━━━ All services running ━━━"
log "  API:       http://localhost:$API_PORT  (PID $API_PID)"
log "  Worker:    PID $WORKER_PID"
log "  Dashboard: http://localhost:$DASH_PORT  (PID $DASH_PID)"
log "  Stop:      kill \$(cat $PID_FILE)  or Ctrl+C"
log ""

# ── Monitor loop ──
# Checks if processes are alive and restarts them if not.
# Also runs periodic API health checks.

last_health_check=$(date +%s)

while true; do
  sleep $COOLDOWN

  # Check API
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "API server died — restarting..."
    start_api
    sleep 3
  fi

  # Check worker
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    log "Worker died — restarting..."
    start_worker
  fi

  # Check dashboard
  if ! kill -0 "$DASH_PID" 2>/dev/null; then
    log "Dashboard died — restarting..."
    start_dashboard
  fi

  # Periodic API health check (even if process is alive, it might be hung)
  now=$(date +%s)
  elapsed=$((now - last_health_check))
  if [ "$elapsed" -ge "$HEALTH_INTERVAL" ]; then
    last_health_check=$now
    if kill -0 "$API_PID" 2>/dev/null && ! check_api_health; then
      log "API process alive but health check failed — killing and restarting..."
      kill "$API_PID" 2>/dev/null || true
      sleep 2
      start_api
    fi
  fi
done
