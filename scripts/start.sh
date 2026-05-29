#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/logs"
SERVER_PID_FILE="$RUN_DIR/solvemate-server.pid"
CLIENT_PID_FILE="$RUN_DIR/solvemate-client.pid"
SERVER_LOG_FILE="$LOG_DIR/solvemate-server.log"
CLIENT_LOG_FILE="$LOG_DIR/solvemate-client.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

SERVER_PID=""
CLIENT_PID=""
[[ -f "$SERVER_PID_FILE" ]] && SERVER_PID="$(cat "$SERVER_PID_FILE")"
[[ -f "$CLIENT_PID_FILE" ]] && CLIENT_PID="$(cat "$CLIENT_PID_FILE")"

if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null && [[ -n "$CLIENT_PID" ]] && kill -0 "$CLIENT_PID" 2>/dev/null; then
  echo "SolveMate is already running."
  echo "Server PID: $SERVER_PID"
  echo "Client PID: $CLIENT_PID"
  echo "Frontend:  http://localhost:5173"
  echo "API:       http://localhost:8787"
  exit 0
fi

rm -f "$SERVER_PID_FILE" "$CLIENT_PID_FILE"

if lsof -ti tcp:5173 >/dev/null 2>&1 || lsof -ti tcp:8787 >/dev/null 2>&1; then
  echo "Port 5173 or 8787 is already in use. Run npm stop first, or free the ports manually."
  exit 1
fi

cd "$ROOT_DIR"
nohup node server/index.js >"$SERVER_LOG_FILE" 2>&1 </dev/null &
SERVER_PID="$!"
echo "$SERVER_PID" > "$SERVER_PID_FILE"
disown "$SERVER_PID" 2>/dev/null || true

nohup node node_modules/vite/bin/vite.js --host 0.0.0.0 >"$CLIENT_LOG_FILE" 2>&1 </dev/null &
CLIENT_PID="$!"
echo "$CLIENT_PID" > "$CLIENT_PID_FILE"
disown "$CLIENT_PID" 2>/dev/null || true

echo "SolveMate started."
echo "Server PID: $SERVER_PID"
echo "Client PID: $CLIENT_PID"
echo "Frontend:  http://localhost:5173"
echo "API:       http://localhost:8787"
echo "Logs:      $SERVER_LOG_FILE"
echo "           $CLIENT_LOG_FILE"
