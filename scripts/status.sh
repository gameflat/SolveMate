#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PID_FILE="$ROOT_DIR/.run/solvemate-server.pid"
CLIENT_PID_FILE="$ROOT_DIR/.run/solvemate-client.pid"
SERVER_LOG_FILE="$ROOT_DIR/logs/solvemate-server.log"
CLIENT_LOG_FILE="$ROOT_DIR/logs/solvemate-client.log"

report_pid() {
  local label="$1"
  local file="$2"
  if [[ -f "$file" ]]; then
    PID="$(cat "$file")"
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      echo "$label pid: $PID"
    else
      echo "$label pid file exists, but the process is not running."
    fi
  else
    echo "$label pid file: missing"
  fi
}

report_pid "Server" "$SERVER_PID_FILE"
report_pid "Client" "$CLIENT_PID_FILE"

for port in 5173 8787; do
  PIDS="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "Port $port: in use by PID(s) $PIDS"
  else
    echo "Port $port: free"
  fi
done

[[ -f "$SERVER_LOG_FILE" ]] && echo "Server log: $SERVER_LOG_FILE"
[[ -f "$CLIENT_LOG_FILE" ]] && echo "Client log: $CLIENT_LOG_FILE"
