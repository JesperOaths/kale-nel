#!/usr/bin/env bash
# Isolated on-phone motion companion. Does not replace IP Webcam or hub recording.
set -Eeuo pipefail
umask 077
BASE="$HOME/c720p-home-hub/build/s9-edge-v1"
SRC="$BASE/src"
REP="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/s9-edge-v1"
mkdir -p "$SRC/nl/kalenel/s9edge" "$BASE/classes" "$BASE/dex"
curl -fsSL --retry 2 "$REP/AndroidManifest.xml" -o "$BASE/AndroidManifest.xml"
curl -fsSL --retry 2 "$REP/src/nl/kalenel/s9edge/EdgeActivity.java" -o "$SRC/nl/kalenel/s9edge/EdgeActivity.java"
curl -fsSL --retry 2 "$REP/src/nl/kalenel/s9edge/EdgeService.java" -o "$SRC/nl/kalenel/s9edge/EdgeService.java"
ANDROID_JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
[ -n "$ANDROID_JAR" ] || { echo "ERROR=no_android_jar";exit 5; }
for tool in javac aapt d8 apksigner keytool adb;do command -v "$tool" >/dev/null;done
javac -source 8 -target 8 -cp "$ANDROID_JAR" -d "$BASE/classes" "$SRC/nl/kalenel/s9edge/EdgeActivity.java" "$SRC/nl/kalenel/s9edge/EdgeService.java"
d8 --min-api 26 --lib "$ANDROID_JAR" --output "$BASE/dex" "$BASE"/classes/nl/kalenel/s9edge/*.class
aapt package -f -M "$BASE/AndroidManifest.xml" -I "$ANDROID_JAR" -F "$BASE/s9-edge-unsigned.apk"
(cd "$BASE/dex" && aapt add "$BASE/s9-edge-unsigned.apk" classes.dex)
KEYDIR="$HOME/.config/s9edge-signing"
mkdir -p "$KEYDIR"
PASS="$KEYDIR/password"
KEY="$KEYDIR/s9edge.jks"
if [ ! -s "$PASS" ]; then
 python3 -c 'import secrets,sys;open(sys.argv[1],"w").write(secrets.token_hex(24)+"\n")' "$PASS"
fi
if [ ! -s "$KEY" ]; then
 PASSWORD="$(head -n1 "$PASS")"
 keytool -genkeypair -noprompt -alias s9edge -keyalg RSA -keysize 2048 -validity 3650 \
  -dname 'CN=S9 Edge Motion,O=Kalenel' \
  -keystore "$KEY" -storepass "$PASSWORD" -keypass "$PASSWORD" >/dev/null
fi
# apksigner consumes the keystore and key passwords as two separate lines.
python3 -c 'from pathlib import Path;import sys;p=Path(sys.argv[1]);v=p.read_text().splitlines()[0];p.write_text((v+"\n")*12)' "$PASS"
apksigner sign --ks "$KEY" --ks-key-alias s9edge \
 --ks-pass "file:$PASS" \
 --out "$BASE/s9-edge-v1.apk" "$BASE/s9-edge-unsigned.apk"
apksigner verify --verbose "$BASE/s9-edge-v1.apk" | head -8
adb connect 192.168.178.250:5555
adb -s 192.168.178.250:5555 install -r -g "$BASE/s9-edge-v1.apk"
adb -s 192.168.178.250:5555 shell am start -n nl.kalenel.s9edge/.EdgeActivity
sleep 5
adb -s 192.168.178.250:5555 forward tcp:18798 tcp:8798
echo "COMPANION_STATUS:"
curl -fsS --max-time 5 http://127.0.0.1:18798/status
echo
echo "CAMERA_HEALTH:"
curl -fsS --max-time 5 http://127.0.0.1:8793/health.json | python3 -c 'import sys,json;v=json.load(sys.stdin);print({"ok":v.get("camera_ok"),"recording":v.get("recording"),"version":v.get("version")})'
echo "S9_COMPANION_INSTALLED=1"
