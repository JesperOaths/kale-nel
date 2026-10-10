#!/usr/bin/env bash
# Sign an APK built from the same immutable revision as its compiled classes.
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
LIB="$HOME/c720p-home-hub/build/s9-person-ml-v1/deps"
REFERENCE="$HOME/c720p-home-hub/build/s9-person-ml-v1/assets"
test -s "$ROOT/.source-commit"
test -s "$ROOT/.compiled-commit"
cmp -s "$ROOT/.source-commit" "$ROOT/.compiled-commit" || { echo "APK_SOURCE_COMPILE_REVISION_MISMATCH" >&2; exit 4; }
test -s "$ROOT/AndroidManifest.xml"
test -s "$ROOT/classes/nl/kalenel/s9security/PreviewJpeg.class"
test -s "$ROOT/classes/nl/kalenel/s9security/CameraService.class"
test -s "$ROOT/classes/nl/kalenel/s9security/CameraOrientation.class"
JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
test -s "$JAR"
mkdir -p "$ROOT/assets" "$ROOT/dex" "$ROOT/pkg/lib/arm64-v8a"
for name in detect.tflite labelmap.txt; do
  test -s "$REFERENCE/$name" || { echo "MISSING_MODEL_ASSET=$name" >&2; exit 4; }
  cp "$REFERENCE/$name" "$ROOT/assets/$name"
done
test "$(stat -c '%s' "$ROOT/assets/detect.tflite")" -gt 1000000
unzip -p "$LIB/tensorflow-lite.aar" jni/arm64-v8a/libtensorflowlite_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
unzip -p "$LIB/tensorflow-lite-gpu.aar" jni/arm64-v8a/libtensorflowlite_gpu_jni.so > "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_gpu_jni.so"
test -s "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
test -s "$ROOT/pkg/lib/arm64-v8a/libtensorflowlite_gpu_jni.so"
rm -f "$ROOT/dex/classes.dex" "$ROOT/unsigned.apk"
d8 --min-api 26 --lib "$JAR" --output "$ROOT/dex" "$ROOT"/classes/nl/kalenel/s9security/*.class \
  "$LIB/tensorflow-lite.jar" "$LIB/tensorflow-lite-api.jar" "$LIB/tensorflow-lite-gpu.jar" "$LIB/tensorflow-lite-gpu-api.jar"
test -s "$ROOT/dex/classes.dex"
aapt package -f -M "$ROOT/AndroidManifest.xml" -I "$JAR" -A "$ROOT/assets" -F "$ROOT/unsigned.apk"
(cd "$ROOT/dex" && aapt add "$ROOT/unsigned.apk" classes.dex)
(cd "$ROOT/pkg" && aapt add "$ROOT/unsigned.apk" lib/arm64-v8a/libtensorflowlite_jni.so lib/arm64-v8a/libtensorflowlite_gpu_jni.so)
KEY="$HOME/.config/s9-native-security-sign"
mkdir -p "$KEY"
if [[ ! -s "$KEY/pass" ]]; then
  python3 -c 'import secrets,sys;open(sys.argv[1],"w").write(secrets.token_hex(24)+"\n")' "$KEY/pass"
  chmod 600 "$KEY/pass"
fi
if [[ ! -s "$KEY/key.jks" ]]; then
  P="$(head -n1 "$KEY/pass")"
  keytool -genkeypair -noprompt -alias s9security -keyalg RSA -keysize 2048 -validity 3650 \
    -dname 'CN=S9 Native Security,O=Kalenel' -keystore "$KEY/key.jks" -storepass "$P" -keypass "$P" >/dev/null
fi
apksigner sign --ks "$KEY/key.jks" --ks-key-alias s9security --ks-pass "file:$KEY/pass" \
  --out "$ROOT/s9-native-security.apk" "$ROOT/unsigned.apk"
apksigner verify --verbose "$ROOT/s9-native-security.apk"
sha256sum "$ROOT/s9-native-security.apk" > "$ROOT/s9-native-security.apk.sha256"
cp "$ROOT/.compiled-commit" "$ROOT/s9-native-security.apk.source-commit"
echo "SIGNED_APK_SOURCE_COMMIT=$(cat "$ROOT/.compiled-commit")"
ls -lh "$ROOT/s9-native-security.apk"
