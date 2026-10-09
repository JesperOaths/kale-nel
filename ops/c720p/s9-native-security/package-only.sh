#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
LIB="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
OLD="$HOME/c720p-home-hub/build/s9-person-ml-v1/assets"
mkdir -p "$ROOT/assets" "$ROOT/dex" "$ROOT/pkg/lib/arm64-v8a"
test -s "$OLD/detect.tflite"
cp "$OLD/detect.tflite" "$ROOT/assets/detect.tflite"
cp "$OLD/labelmap.txt" "$ROOT/assets/labelmap.txt"
curl -fsSL https://raw.githubusercontent.com/JesperOaths/kale-nel/c634bb316ba713304ce263fb5d00fe46bb0efad2/ops/c720p/s9-native-security/AndroidManifest.xml -o "$ROOT/AndroidManifest.xml"
unzip -p "$LIB/tensorflow-lite.aar" jni/arm64-v8a/libtensorflowlite_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
unzip -p "$LIB/tensorflow-lite-gpu.aar" jni/arm64-v8a/libtensorflowlite_gpu_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_gpu_jni.so"
JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
d8 --min-api 26 --lib "$JAR" --output "$ROOT/dex" "$ROOT"/classes/nl/kalenel/s9security/*.class \
 "$LIB/tensorflow-lite.jar" "$LIB/tensorflow-lite-api.jar" "$LIB/tensorflow-lite-gpu.jar" "$LIB/tensorflow-lite-gpu-api.jar"
aapt package -f -M "$ROOT/AndroidManifest.xml" -I "$JAR" -A "$ROOT/assets" -F "$ROOT/unsigned.apk"
(cd "$ROOT/dex" && aapt add "$ROOT/unsigned.apk" classes.dex)
(cd "$ROOT/pkg" && aapt add "$ROOT/unsigned.apk" lib/arm64-v8a/libtensorflowlite_jni.so lib/arm64-v8a/libtensorflowlite_gpu_jni.so)
KEY="$HOME/.config/s9-native-security-sign"
mkdir -p "$KEY"
if [[ ! -s "$KEY/pass" ]];then python3 -c 'import sys,secrets;open(sys.argv[1],"w").write((secrets.token_hex(24)+"\n")*12)' "$KEY/pass";fi
if [[ ! -s "$KEY/key.jks" ]];then
 P="$(head -n1 "$KEY/pass")"
 keytool -genkeypair -noprompt -alias s9security -keyalg RSA -keysize 2048 -validity 3650 \
 -dname 'CN=S9 Native Security,O=Kalenel' -keystore "$KEY/key.jks" -storepass "$P" -keypass "$P" >/dev/null
fi
apksigner sign --ks "$KEY/key.jks" --ks-key-alias s9security --ks-pass "file:$KEY/pass" \
 --out "$ROOT/s9-native-security.apk" "$ROOT/unsigned.apk"
apksigner verify "$ROOT/s9-native-security.apk"
ls -lh "$ROOT/s9-native-security.apk"
echo "NATIVE_SECURITY_APK_SIGNED"
