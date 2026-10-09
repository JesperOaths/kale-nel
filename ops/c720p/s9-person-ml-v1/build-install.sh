#!/usr/bin/env bash
# Isolated ML shadow detector. Existing phone recording and hub services untouched.
set -Eeuo pipefail
umask 077
BASE="$HOME/c720p-home-hub/build/s9-person-ml-v1"
LIB="$BASE/deps"
SRC="$BASE/src"
REP="https://raw.githubusercontent.com/JesperOaths/kale-nel/33d42bd3a1e97f974b2d2a6f5d11ed0ed41019a1/ops/c720p/s9-person-ml-v1"
mkdir -p "$LIB" "$SRC/nl/kalenel/s9person" "$BASE/classes" "$BASE/dex" "$BASE/pkg/lib/arm64-v8a" "$BASE/assets"
curl -fsSL --retry 2 "$REP/AndroidManifest.xml" -o "$BASE/AndroidManifest.xml"
for name in PersonActivity Boot PersonService; do
 curl -fsSL --retry 2 "$REP/src/nl/kalenel/s9person/$name.java" -o "$SRC/nl/kalenel/s9person/$name.java"
done
TF="https://repo.maven.apache.org/maven2/org/tensorflow"
download_aar(){
 local part="$1"; local outfile="$LIB/$part.aar"
 if [[ ! -s "$outfile" ]];then
  curl -fLsS --retry 2 --max-time 50 "$TF/$part/2.14.0/$part-2.14.0.aar" -o "$outfile"
 fi
 unzip -p "$outfile" classes.jar > "$LIB/$part.jar"
}
download_aar tensorflow-lite
download_aar tensorflow-lite-api
download_aar tensorflow-lite-gpu
download_aar tensorflow-lite-gpu-api
MODEL_ZIP="$LIB/coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip"
if [[ ! -s "$MODEL_ZIP" ]];then
 curl -fLsS --retry 2 --max-time 60 https://storage.googleapis.com/download.tensorflow.org/models/tflite/coco_ssd_mobilenet_v1_1.0_quant_2018_06_29.zip -o "$MODEL_ZIP"
fi
unzip -p "$MODEL_ZIP" detect.tflite > "$BASE/assets/detect.tflite"
unzip -p "$MODEL_ZIP" labelmap.txt > "$BASE/assets/labelmap.txt"
test "$(stat -c '%s' "$BASE/assets/detect.tflite")" -gt 1000000
unzip -p "$LIB/tensorflow-lite.aar" jni/arm64-v8a/libtensorflowlite_jni.so > "$BASE/pkg/lib/arm64-v8a/libtensorflowlite_jni.so"
unzip -p "$LIB/tensorflow-lite-gpu.aar" jni/arm64-v8a/libtensorflowlite_gpu_jni.so > "$BASE/pkg/lib/arm64-v8a/libtensorflowlite_gpu_jni.so"
ANDROID_JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
test -n "$ANDROID_JAR"
CLASSPATH="$ANDROID_JAR:$LIB/tensorflow-lite.jar:$LIB/tensorflow-lite-api.jar:$LIB/tensorflow-lite-gpu.jar:$LIB/tensorflow-lite-gpu-api.jar"
javac -source 8 -target 8 -cp "$CLASSPATH" -d "$BASE/classes" \
 "$SRC/nl/kalenel/s9person/PersonActivity.java" \
 "$SRC/nl/kalenel/s9person/PersonService.java" \
 "$SRC/nl/kalenel/s9person/Boot.java"
d8 --min-api 26 --lib "$ANDROID_JAR" --output "$BASE/dex" \
 "$BASE"/classes/nl/kalenel/s9person/*.class \
 "$LIB/tensorflow-lite.jar" "$LIB/tensorflow-lite-api.jar" \
 "$LIB/tensorflow-lite-gpu.jar" "$LIB/tensorflow-lite-gpu-api.jar"
aapt package -f -M "$BASE/AndroidManifest.xml" -I "$ANDROID_JAR" \
 -A "$BASE/assets" -F "$BASE/s9-person-unsigned.apk"
(cd "$BASE/dex" && aapt add "$BASE/s9-person-unsigned.apk" classes.dex)
(cd "$BASE/pkg" && aapt add "$BASE/s9-person-unsigned.apk" \
 lib/arm64-v8a/libtensorflowlite_jni.so \
 lib/arm64-v8a/libtensorflowlite_gpu_jni.so)
KEYDIR="$HOME/.config/s9person-signing"
mkdir -p "$KEYDIR"
PASS="$KEYDIR/password"
KEY="$KEYDIR/s9person.jks"
if [[ ! -s "$PASS" ]];then
 python3 -c 'import secrets,sys;open(sys.argv[1],"w").write(secrets.token_hex(24)+"\n")' "$PASS"
fi
if [[ ! -s "$KEY" ]];then
 PASSWORD="$(head -n1 "$PASS")"
 keytool -genkeypair -noprompt -alias s9person -keyalg RSA -keysize 2048 -validity 3650 \
 -dname 'CN=S9 Person ML,O=Kalenel' -keystore "$KEY" -storepass "$PASSWORD" -keypass "$PASSWORD" >/dev/null
fi
python3 -c 'from pathlib import Path;import sys;p=Path(sys.argv[1]);v=p.read_text().splitlines()[0];p.write_text((v+"\n")*12)' "$PASS"
apksigner sign --ks "$KEY" --ks-key-alias s9person \
 --ks-pass "file:$PASS" --out "$BASE/s9-person-v1.apk" "$BASE/s9-person-unsigned.apk"
apksigner verify "$BASE/s9-person-v1.apk"
adb connect 192.168.178.250:5555
adb -s 192.168.178.250:5555 install -r "$BASE/s9-person-v1.apk"
adb -s 192.168.178.250:5555 shell am start -n nl.kalenel.s9person/.PersonActivity
sleep 8
adb connect 192.168.178.250:5555 >/dev/null
adb -s 192.168.178.250:5555 forward tcp:18799 tcp:8799
echo ML_STATUS:
for t in 1 2 3 4 5;do
 if curl -fsS --max-time 6 http://127.0.0.1:18799/status;then break;fi
 sleep 4
done
echo
echo MAIN_RECORDING_STATUS:
curl -fsS --max-time 6 http://192.168.178.250:8080/status.json |
 python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("video_status"))'
echo "ML_SHADOW_INSTALLED=1"
