#!/data/data/com.vscodroid/files/usr/bin/bash
# Start the GospelOnTheMountain.Node web server.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/server.js" "$@"
