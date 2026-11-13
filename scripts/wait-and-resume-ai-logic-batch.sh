#!/bin/bash
# Detached waiter + resume for the Firebase AI Logic batch.
# Spark only. Never enable billing. Appends to notes/batch-parse-log.jsonl.
set -euo pipefail
cd /workspace/competitions/firebase-hybridai/inclusion
mkdir -p notes
echo $$ > notes/batch-resume.pid
echo "$(date '+%Y-%m-%d %H:%M:%S %Z')  detached waiter pid $$  sid $(ps -o sid= -p $$ | tr -d ' ')" >> notes/batch-quota-pause.txt

WAIT_SECS=$(python3 - << 'PY'
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import json

pt = ZoneInfo("America/Los_Angeles")
et = ZoneInfo("America/New_York")
now = datetime.now(pt)
stop_at = None
log = Path("notes/batch-parse-log.jsonl")
if log.exists():
    for line in log.read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("hardStop") and row.get("at"):
            stop_at = row["at"]

# Official Gemini Developer API docs: RPD quotas reset at midnight Pacific time.
# After a daily-quota hard stop, wait until the next midnight Pacific plus a
# 3-minute buffer. If that window has already opened, start immediately.
if stop_at:
    stop = datetime.fromisoformat(stop_at.replace("Z", "+00:00")).astimezone(pt)
    midnight = stop.replace(hour=0, minute=0, second=0, microsecond=0)
    next_midnight = midnight + timedelta(days=1) if stop >= midnight else midnight
    target = next_midnight + timedelta(minutes=3)
else:
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    target = midnight + timedelta(minutes=3)
    if now >= target:
        target = now

wait = max(0, int((target - now).total_seconds()))
Path("notes/batch-resume-target.txt").write_text(
    f"target_pt={target.isoformat()}\n"
    f"target_et={target.astimezone(et).isoformat()}\n"
    f"wait_secs={wait}\n"
)
print(wait)
PY
)

if [ "$WAIT_SECS" -gt 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S %Z')  waiting ${WAIT_SECS}s until after midnight Pacific (see notes/batch-resume-target.txt)" >> notes/batch-quota-pause.txt
  LEFT=$WAIT_SECS
  while [ "$LEFT" -gt 0 ]; do
    CHUNK=300
    if [ "$LEFT" -lt "$CHUNK" ]; then
      CHUNK=$LEFT
    fi
    sleep "$CHUNK"
    LEFT=$((LEFT - CHUNK))
    echo "$(date '+%H:%M:%S %Z')  ${LEFT}s until resume" >> notes/batch-quota-pause.txt
  done
fi

echo "$(date '+%Y-%m-%d %H:%M:%S %Z')  starting resume: node scripts/batch-parse-ai-logic.mjs --resume (pid $$)" >> notes/batch-quota-pause.txt
# Same PID after exec, so notes/batch-resume.pid stays valid.
exec node scripts/batch-parse-ai-logic.mjs --resume
