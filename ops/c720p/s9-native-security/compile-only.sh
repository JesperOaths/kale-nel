#!/usr/bin/env bash
# Compile a coherent S9 native source revision without installing the APK.
set -Eeuo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
"$BASE/fetch-source.sh"
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
LIB="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
SRC="$ROOT/src/nl/kalenel/s9security"
JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
test -s "$JAR" || { echo "ANDROID_SDK_PLATFORM_MISSING" >&2; exit 4; }
for name in tensorflow-lite tensorflow-lite-api tensorflow-lite-gpu tensorflow-lite-gpu-api; do
  test -s "$LIB/$name.jar" || { echo "MISSING_TFLITE_DEPENDENCY=$name" >&2; exit 4; }
done
mkdir -p "$ROOT/classes"
find "$ROOT/classes" -type f -name '*.class' -delete
CLASSPATH="$JAR:$LIB/tensorflow-lite.jar:$LIB/tensorflow-lite-api.jar:$LIB/tensorflow-lite-gpu.jar:$LIB/tensorflow-lite-gpu-api.jar"
javac -source 8 -target 8 -cp "$CLASSPATH" -d "$ROOT/classes" "$SRC"/*.java
test -s "$ROOT/classes/nl/kalenel/s9security/PreviewJpeg.class"
test -s "$ROOT/classes/nl/kalenel/s9security/CameraService.class"
test -s "$ROOT/classes/nl/kalenel/s9security/AnonymousClipTracks.class"
test -s "$ROOT/classes/nl/kalenel/s9security/CameraOrientation.class"
cp "$ROOT/.source-commit" "$ROOT/.compiled-commit"
echo "S9_NATIVE_SECURITY_COMPILED_REVISION=$(cat "$ROOT/.compiled-commit")"
