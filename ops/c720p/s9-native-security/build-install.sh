#!/usr/bin/env bash
# Isolated shadow installation. Do not stop IP Webcam or enable native recording here.
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
LIB="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
SRC="$ROOT/src/nl/kalenel/s9security"
REP="https://raw.githubusercontent.com/JesperOaths/kale-nel/c634bb316ba713304ce263fb5d00fe46bb0efad2/ops/c720p/s9-native-security"
mkdir -p "$SRC" "$ROOT/classes" "$ROOT/dex" "$ROOT/assets" "$ROOT/pkg/lib/arm64-v8a"
curl -fsSL "$REP/AndroidManifest.xml" -o "$ROOT/AndroidManifest.xml"
for class in CameraActivity CameraService MotionGrid ClipClassifier Boot;do
 curl -fsSL "$REP/src/nl/kalenel/s9security/$class.java" -o "$SRC/$class.java"
done
for name in tensorflow-lite tensorflow-lite-api tensorflow-lite-gpu tensorflow-lite-gpu-api;do
 test -s "$LIB/$name.jar" || { echo "MISSING_TFLITE_DEPENDENCY=$name" >&2;exit 4; }
done
REFERENCE="$HOME/c720p-home-hub/build/s9-person-ml-v1/assets"
if [ -s "$REFERENCE/detect.tflite" ] && [ -s "$REFERENCE/labelmap.txt" ];then
 cp "$REFERENCE/detect.tflite" "$ROOT/assets/detect.tflite"
 cp "$REFERENCE/labelmap.txt" "$ROOT/assets/labelmap.txt"
else
 curl -fsSL https://storage.googleapis.com/download.tensorflow.org/models/tflite/coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip -o "$ROOT/model.zip"
 unzip -p "$ROOT/model.zip" detect.tflite > "$ROOT/assets/detect.tflite"
 unzip -p "$ROOT/model.zip" labelmap.txt > "$ROOT/assets/labelmap.txt"
fi
test "$(stat -c '%s' "$ROOT/assets/detect.tflite")" -gt 1000000
unzip -p "$LIB/tensorflow-lite.aar" jni/arm64-v8a/libtensorflowlite_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
unzip -p "$LIB/tensorflow-lite-gpu.aar" jni/arm64-v8a/libtensorflowlite_gpu_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_gpu_jni.so"
ANDROID_JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
CLASSPATH="$ANDROID_JAR:$LIB/tensorflow-lite.jar:$LIB/tensorflow-lite-api.jar:$LIB/tensorflow-lite-gpu.jar:$LIB/tensorflow-lite-gpu-api.jar"
javac -source 8 -target 8 -cp "$CLASSPATH" -d "$ROOT/classes" "$SRC"/*.java
d8 --min-api 26 --lib "$ANDROID_JAR" --output "$ROOT/dex" "$ROOT"/classes/nl/kalenel/s9security/*.class \
 "$LIB/tensorflow-lite.jar" "$LIB/tensorflow-lite-api.jar" "$LIB/tensorflow-lite-gpu.jar" "$LIB/tensorflow-lite-gpu-api.jar"
aapt package -f -M "$ROOT/AndroidManifest.xml" -I "$ANDROID_JAR" -A "$ROOT/assets" -F "$ROOT/unsigned.apk"
(cd "$ROOT/dex" && aapt add "$ROOT/unsigned.apk" classes.dex)
(cd "$ROOT/pkg" && aapt add "$ROOT/unsigned.apk" lib/arm64-v8a/libtensorflowlite_jni.so lib/arm64-v8a/libtensorflowlite_gpu_jni.so)
K="$HOME/.config/s9-native-security-sign"
mkdir -p "$K"
if [ ! -s "$K/pass" ];then python3 -c 'import secrets,sys;open(sys.argv[1],"w").write((secrets.token_hex(24)+"\n")*12)' "$K/pass";fi
if [ ! -s "$K/key.jks" ];then
 P="$(head -n1 "$K/pass")"
 keytool -genkeypair -noprompt -alias s9security -keyalg RSA -keysize 2048 -validity 3650 \
 -dname 'CN=S9 Native Security,O=Kalenel' -keystore "$K/key.jks" -storepass "$P" -keypass "$P" >/dev/null
fi
apksigner sign --ks "$K/key.jks" --ks-key-alias s9security --ks-pass "file:$K/pass" --out "$ROOT/s9-native-security.apk" "$ROOT/unsigned.apk"
apksigner verify --verbose "$ROOT/s9-native-security.apk" | head -7
echo "SHADOW_APK_BUILD_OK"
adb connect 192.168.178.250:5555
adb -s 192.168.178.250:5555 install -r -g "$ROOT/s9-native-security.apk"
adb -s 192.168.178.250:5555 shell pm grant nl.kalenel.s9security android.permission.CAMERA
echo "SHADOW_APP_INSTALLED_NOT_ARMED"
