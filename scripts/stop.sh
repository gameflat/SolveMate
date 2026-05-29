#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILES=(
  "$ROOT_DIR/.run/solvemate-server.pid"
  "$ROOT_DIR/.run/solvemate-client.pid"
)

kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

STOPPED=0

for pid_file in "${PID_FILES[@]}"; do
  if [[ -f "$pid_file" ]]; then
    PID="$(cat "$pid_file")"
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill_tree "$PID"
      STOPPED=1
      echo "Stopped SolveMate process tree rooted at PID $PID"
    fi
    rm -f "$pid_file"
  fi
done

for port in 5173 8787; do
  PIDS="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    for pid in $PIDS; do
      kill_tree "$pid"
      STOPPED=1
      echo "Stopped process on port $port with PID $pid"
    done
  fi
done

if [[ "$STOPPED" -eq 0 ]]; then
  echo "SolveMate is not running."
fi
