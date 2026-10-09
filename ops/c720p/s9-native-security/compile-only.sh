#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
LIB="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
SRC="$ROOT/src/nl/kalenel/s9security"
REP="https://raw.githubusercontent.com/JesperOaths/kale-nel/26b8eb5ffd70b06bc681e470bdf8c7764aa8b3b3/ops/c720p/s9-native-security"
mkdir -p "$SRC" "$ROOT/classes"
for class in CameraActivity CameraService MotionGrid ClipClassifier PreviewJpeg Boot;do
 curl -fsSL "$REP/src/nl/kalenel/s9security/$class.java" -o "$SRC/$class.java"
done
ANDROID_JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
CLASSPATH="$ANDROID_JAR:$LIB/tensorflow-lite.jar:$LIB/tensorflow-lite-api.jar:$LIB/tensorflow-lite-gpu.jar:$LIB/tensorflow-lite-gpu-api.jar"
javac -source 8 -target 8 -cp "$CLASSPATH" -d "$ROOT/classes" "$SRC"/*.java
echo "S9_NATIVE_SECURITY_JAVA_COMPILE_OK"
