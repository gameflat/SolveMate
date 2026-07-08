#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/solvemate.pid"
PORT=8787

process_exists() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

port_listening() {
  local port="$1"
  ss -ltn "sport = :$port" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit found ? 0 : 1 }'
}

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
  if process_exists "$PID"; then
    kill_tree "$PID"
    sleep 1
    if process_exists "$PID"; then
      echo "Could not stop SolveMate (PID $PID). Check process ownership or run as root."
    else
      STOPPED=1
      echo "Stopped SolveMate (PID $PID)."
    fi
  fi
  if ! process_exists "${PID:-}"; then
    rm -f "$PID_FILE"
  fi
fi

for port in "$PORT"; do
  PIDS="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    for pid in $PIDS; do
      kill_tree "$pid"
      sleep 1
      if process_exists "$pid"; then
        echo "Could not stop process on port $port (PID $pid). Check process ownership or run as root."
      else
        STOPPED=1
        echo "Stopped process on port $port (PID $pid)."
      fi
    done
  elif port_listening "$port"; then
    echo "Port $port is still in use, but PID is unavailable. Run stop as root or inspect with: ss -ltnp | grep ':$port'"
  fi
done

if [[ "$STOPPED" -eq 0 ]]; then
  echo "SolveMate is not running."
fi
