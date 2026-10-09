#!/usr/bin/env bash
# Separate, isolated S9+ native-2160p test APK. Does not modify existing security apps.
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub/build/s9-native4k"
REPO="https://raw.githubusercontent.com/JesperOaths/kale-nel/3cc1908d92bb4df3ebe2b2aaec1f75b04987caf2/ops/c720p/s9-native4k"
mkdir -p "$ROOT/src/nl/kalenel/s9nativefourk" "$ROOT/classes" "$ROOT/dex"
curl -fsSL "$REPO/AndroidManifest.xml" -o "$ROOT/AndroidManifest.xml"
for class in CameraActivity CameraService; do
 curl -fsSL "$REPO/src/nl/kalenel/s9nativefourk/$class.java" -o "$ROOT/src/nl/kalenel/s9nativefourk/$class.java"
done
JAR="$(find /usr/lib/android-sdk/platforms -name android.jar | sort -V | tail -1)"
javac -source 8 -target 8 -cp "$JAR" -d "$ROOT/classes" "$ROOT/src/nl/kalenel/s9nativefourk/"*.java
d8 --min-api 26 --lib "$JAR" --output "$ROOT/dex" "$ROOT"/classes/nl/kalenel/s9nativefourk/*.class
aapt package -f -M "$ROOT/AndroidManifest.xml" -I "$JAR" -F "$ROOT/unsigned.apk"
(cd "$ROOT/dex" && aapt add "$ROOT/unsigned.apk" classes.dex)
K="$HOME/.config/s9native4k-signing"
mkdir -p "$K"
if [ ! -s "$K/pass" ];then python3 -c 'import secrets,sys;open(sys.argv[1],"w").write((secrets.token_hex(24)+"\n")*12)' "$K/pass";fi
if [ ! -s "$K/key.jks" ];then
 P="$(head -n1 "$K/pass")"
 keytool -genkeypair -noprompt -alias s9native4k -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=S9 4K Test,O=Kalenel' -keystore "$K/key.jks" -storepass "$P" -keypass "$P" >/dev/null
fi
apksigner sign --ks "$K/key.jks" --ks-key-alias s9native4k --ks-pass "file:$K/pass" --out "$ROOT/s9-native-4k.apk" "$ROOT/unsigned.apk"
apksigner verify --verbose "$ROOT/s9-native-4k.apk" | head -9
adb connect 192.168.178.250:5555
adb -s 192.168.178.250:5555 install -r -g "$ROOT/s9-native-4k.apk"
adb -s 192.168.178.250:5555 shell pm grant nl.kalenel.s9nativefourk android.permission.CAMERA
adb -s 192.168.178.250:5555 shell am start -n nl.kalenel.s9nativefourk/.CameraActivity
sleep 3
adb -s 192.168.178.250:5555 logcat -d -s S9_NATIVE4K_CAPS:I | tail -8
