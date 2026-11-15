#!/data/data/com.vscodroid/files/usr/bin/bash
# Compile GospelOnTheMountain.Console with the Mono C# compiler (mcs) on the device.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
bash /data/data/com.vscodroid/files/usr/bin/mcs-android -target:exe -out:"$DIR/GospelOnTheMountain.Console.exe" "$DIR/Program.cs"
echo "Built $DIR/GospelOnTheMountain.Console.exe"
