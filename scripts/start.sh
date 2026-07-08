#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$RUN_DIR/solvemate.pid"
LOG_FILE="$LOG_DIR/solvemate.log"
PORT=8787

process_exists() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  ss -ltn "sport = :$port" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit found ? 0 : 1 }'
}

cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "node_modules not found. Run 'npm install' first."
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if process_exists "$PID"; then
    echo "SolveMate is already running (PID $PID)."
    echo "http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if port_in_use "$PORT"; then
  echo "Port $PORT is already in use. Run npm stop first, or free the port manually."
  exit 1
fi

mkdir -p "$RUN_DIR" "$LOG_DIR"

echo "Building frontend..."
npx vite build --logLevel error

echo "Starting SolveMate..."
nohup node server/index.js >"$LOG_FILE" 2>&1 </dev/null &
PID="$!"
echo "$PID" > "$PID_FILE"
disown "$PID" 2>/dev/null || true

sleep 1
if process_exists "$PID"; then
  echo "SolveMate started (PID $PID)."
  echo "http://localhost:$PORT"
  echo "Logs: $LOG_FILE"
else
  echo "Failed to start. Check $LOG_FILE"
  exit 1
fi
