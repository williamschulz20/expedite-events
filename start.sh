#!/bin/bash
# Start Event Radar. Usage: ./start.sh [port]   (default 3100)
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
PORT="${1:-3100}"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Expected it at ~/.nvm/versions/node/v24.20.0/bin" >&2
  exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund

echo "Event Radar -> http://localhost:$PORT"
exec npm run dev -- --port "$PORT"
