#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/solvemate.pid"

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

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill_tree "$PID"
    STOPPED=1
    echo "Stopped SolveMate (PID $PID)."
  fi
  rm -f "$PID_FILE"
fi

for port in 8787; do
  PIDS="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    for pid in $PIDS; do
      kill_tree "$pid"
      STOPPED=1
      echo "Stopped process on port $port (PID $pid)."
    done
  fi
done

if [[ "$STOPPED" -eq 0 ]]; then
  echo "SolveMate is not running."
fi
