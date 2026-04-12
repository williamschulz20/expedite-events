#!/bin/bash
cd /Users/williamschulz/Desktop/expedite-events

# Add a timestamped log entry (unique per hour)
mkdir -p .daily-log
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
DATE=$(date +%Y-%m-%d)
HOUR=$(date +%H:%M)
echo "Activity log: $DATE $HOUR — Expedite Events GTM tool active" >> ".daily-log/$DATE.md"

git add .daily-log/
git diff --cached --quiet && exit 0  # skip if nothing changed
git commit -m "daily: activity log $TIMESTAMP

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
