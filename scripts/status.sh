#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/solvemate.pid"
LOG_FILE="$ROOT_DIR/logs/solvemate.log"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "SolveMate is running (PID $PID)."
    echo "http://localhost:8787"
  else
    echo "PID file exists but process is not running."
  fi
else
  echo "PID file: missing"
fi

for port in 8787; do
  PIDS="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "Port $port: in use by PID(s) $PIDS"
  else
    echo "Port $port: free"
  fi
done

[[ -f "$LOG_FILE" ]] && echo "Log: $LOG_FILE"
