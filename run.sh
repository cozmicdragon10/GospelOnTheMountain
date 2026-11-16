#!/data/data/com.vscodroid/files/usr/bin/bash
# Start the Worship On The Mountain.Node web server.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/server.js" "$@"
