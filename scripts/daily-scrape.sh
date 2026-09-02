#!/bin/bash
# Self-contained daily scrape: boots its own app instance on a dedicated port,
# runs every scraper into the shared Supabase database, then shuts down.
# Scheduled by launchd (com.expedite.event-scrape); logs to .data/daily-scrape.log
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
PORT=3199
LOG=".data/daily-scrape.log"
mkdir -p .data
exec >>"$LOG" 2>&1
echo "===== daily scrape $(date '+%Y-%m-%d %H:%M:%S') ====="

[ -d node_modules ] || npm install --no-audit --no-fund

npm run dev -- --port $PORT &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -sf "http://localhost:$PORT/api/team" >/dev/null && break
  sleep 2
done
if ! curl -sf "http://localhost:$PORT/api/team" >/dev/null; then
  echo "app failed to start; aborting"
  exit 1
fi

BASE_URL="http://localhost:$PORT" node scripts/scrape-all.mjs
BASE_URL="http://localhost:$PORT" node scripts/eventbrite-year.mjs || echo "year sweep hit rate limits; daily pass already stored"

echo "===== done $(date '+%Y-%m-%d %H:%M:%S') ====="
