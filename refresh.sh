#!/bin/bash
# Re-scrape every source into the database. Safe to run repeatedly:
# events upsert on external_id, so re-runs update rather than duplicate.
# Assumes the app is already running (./start.sh) on the given port.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
PORT="${1:-3100}"

if ! curl -sf -o /dev/null "http://localhost:$PORT/api/team"; then
  echo "App is not running on port $PORT. Start it first with ./start.sh" >&2
  exit 1
fi
BASE_URL="http://localhost:$PORT" node scripts/scrape-all.mjs "${@:2}"

# Deep Eventbrite pass: month-by-month for the next 12 months. Slow (~1h) but
# it is what fills the far end of the calendar. Skip with SKIP_YEAR_SWEEP=1.
if [ -z "$SKIP_YEAR_SWEEP" ] && [ $# -le 1 ]; then
  BASE_URL="http://localhost:$PORT" node scripts/eventbrite-year.mjs
fi
