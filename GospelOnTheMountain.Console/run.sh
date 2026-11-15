#!/data/data/com.vscodroid/files/usr/bin/bash
# Run the compiled GospelOnTheMountain.Console app on Mono.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash /data/data/com.vscodroid/files/usr/bin/mono-android "$DIR/GospelOnTheMountain.Console.exe" "$@"
