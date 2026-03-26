#!/bin/bash
# Auto-restart wrapper for APEX worker
# Usage: ./apps/api/scripts/start-worker.sh
# Restarts automatically on crash with 5-second delay

cd "$(dirname "$0")/.." || exit 1

echo "🚀 APEX worker auto-restart wrapper started"

while true; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting worker..."
  NODE_OPTIONS="--max-old-space-size=2048" npx tsx src/worker.ts
  EXIT_CODE=$?
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Worker exited with code $EXIT_CODE"

  if [ $EXIT_CODE -eq 0 ]; then
    echo "Clean shutdown — not restarting"
    break
  fi

  echo "⚠️ Worker crashed — restarting in 5 seconds..."
  sleep 5
done
