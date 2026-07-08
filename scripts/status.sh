#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/solvemate.pid"
LOG_FILE="$ROOT_DIR/logs/solvemate.log"
PORT=8787

process_exists() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

port_listening() {
  local port="$1"
  ss -ltn "sport = :$port" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit found ? 0 : 1 }'
}

port_pids() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if process_exists "$PID"; then
    echo "SolveMate is running (PID $PID)."
    echo "http://localhost:$PORT"
  else
    echo "PID file exists but process is not running."
  fi
else
  echo "PID file: missing"
fi

for port in "$PORT"; do
  PIDS="$(port_pids "$port")"
  if [[ -n "$PIDS" ]]; then
    echo "Port $port: in use by PID(s) $PIDS"
  elif port_listening "$port"; then
    echo "Port $port: in use (PID unavailable; run as root for process details)"
  else
    echo "Port $port: free"
  fi
done

[[ -f "$LOG_FILE" ]] && echo "Log: $LOG_FILE"
