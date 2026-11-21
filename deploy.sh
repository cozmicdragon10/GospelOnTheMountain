#!/data/data/com.vscodroid/files/usr/bin/bash
# Pull the latest main branch from GitHub and restart the web server.
# Started by the /api/deploy webhook in server.js (or run it by hand).
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/deploy.log"
PID_FILE="$DIR/server.pid"

exec >>"$LOG" 2>&1
echo "== deploy started $(date -u +%FT%TZ)"
cd "$DIR" || { echo "cannot cd to $DIR"; exit 1; }

if ! git fetch origin main; then
  echo "git fetch failed"; exit 1
fi
# GitHub is the source of truth: match it exactly.
if ! git reset --hard origin/main; then
  echo "git reset failed"; exit 1
fi

# Install dependencies (node_modules is not in git). Done before stopping the old server,
# so a failed install leaves the current server running.
if ! npm ci --omit=dev --no-audit --no-fund; then
  echo "npm ci failed"; exit 1
fi

# Stop the running server, if any.
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE")"
  echo "stopping server pid $OLD_PID"
  kill "$OLD_PID" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 1
  done
fi

# Start the new server in the background.
nohup node "$DIR/server.js" >>"$LOG" 2>&1 &
echo "started server pid $!"
echo "== deploy finished $(date -u +%FT%TZ)"
