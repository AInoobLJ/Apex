#!/usr/bin/env bash
# APEX Worker — auto-restart loop
# Usage: ./start-worker.sh        (foreground)
#        nohup ./start-worker.sh &  (background, survives terminal close)
#
# Restarts the worker if it crashes, with a 5-second cooldown to avoid
# tight restart loops. Logs to /tmp/apex-worker.log.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_DIR="$SCRIPT_DIR/apps/api"
LOG_FILE="/tmp/apex-worker.log"
COOLDOWN=5          # seconds between restarts
MAX_RAPID=10        # max rapid restarts before backing off
RAPID_WINDOW=300    # seconds — if MAX_RAPID restarts happen within this window, back off
BACKOFF=60          # seconds to wait after too many rapid restarts

rapid_count=0
window_start=$(date +%s)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [start-worker] $*" | tee -a "$LOG_FILE"
}

cleanup() {
  log "Received shutdown signal — stopping worker"
  kill "$WORKER_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
  log "Worker stopped cleanly"
  exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

cd "$WORKER_DIR"

log "=== APEX Worker restart loop started ==="
log "Working dir: $WORKER_DIR"
log "Log file: $LOG_FILE"

while true; do
  log "Starting worker..."
  npx tsx src/worker.ts >> "$LOG_FILE" 2>&1 &
  WORKER_PID=$!
  log "Worker started (PID: $WORKER_PID)"

  # Wait for worker to exit
  wait "$WORKER_PID" || true
  EXIT_CODE=$?
  log "Worker exited with code $EXIT_CODE"

  # Track rapid restarts
  now=$(date +%s)
  elapsed=$((now - window_start))
  if [ "$elapsed" -gt "$RAPID_WINDOW" ]; then
    # Reset window
    rapid_count=0
    window_start=$now
  fi
  rapid_count=$((rapid_count + 1))

  if [ "$rapid_count" -ge "$MAX_RAPID" ]; then
    log "WARNING: $rapid_count restarts in ${elapsed}s — backing off ${BACKOFF}s"
    sleep $BACKOFF
    rapid_count=0
    window_start=$(date +%s)
  else
    log "Restarting in ${COOLDOWN}s... (restart $rapid_count/$MAX_RAPID in window)"
    sleep $COOLDOWN
  fi
done
