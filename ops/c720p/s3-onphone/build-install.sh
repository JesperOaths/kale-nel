#!/usr/bin/env bash
set -euo pipefail
SDK=/usr/lib/android-sdk
TOOLS="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-36/android.jar"
ROOT="/home/jespern/c720p-home-hub"
WORK="$ROOT/build/s3-onphone"
STATE="$ROOT/state"
BASE_URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/d62f8591201b5ce13f495cac8199fee7440f3d15/ops/c720p/s3-onphone"
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/src/nl/kalenel/s3motion" "$STATE"
curl -fsSL "$BASE_URL/AndroidManifest.xml" -o "$WORK/AndroidManifest.xml"
curl -fsSL "$BASE_URL/src/nl/kalenel/s3motion/MotionActivity.java" -o "$WORK/src/nl/kalenel/s3motion/MotionActivity.java"
javac -source 8 -target 8 -cp "$PLATFORM" -d "$WORK/classes" \
    "$WORK/src/nl/kalenel/s3motion/MotionActivity.java"
"$TOOLS/d8" --min-api 19 --lib "$PLATFORM" --output "$WORK/dex" \
    "$WORK/classes/nl/kalenel/s3motion/MotionActivity.class"
"$TOOLS/aapt" package -f -M "$WORK/AndroidManifest.xml" -I "$PLATFORM" \
    -F "$WORK/s3-motion-unsigned.apk"
(cd "$WORK/dex"; zip -q -u "$WORK/s3-motion-unsigned.apk" classes.dex)
PASSFILE="$STATE/s3-motion-signing-password"
KEYSTORE="$STATE/s3-motion-signing.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
    umask 077
    python3 -c 'import secrets,sys;open(sys.argv[1],"w").write(secrets.token_urlsafe(30))' "$PASSFILE"
    keytool -genkeypair -noprompt -keystore "$KEYSTORE" \
        -alias s3motion -keyalg RSA -keysize 2048 -validity 15000 \
        -dname "CN=S3 Bedroom Motion, OU=Private Home, O=Local" \
        -storepass "$(cat "$PASSFILE")" -keypass "$(cat "$PASSFILE")"
fi
cp "$WORK/s3-motion-unsigned.apk" "$WORK/s3-bedroom-motion.apk"
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias s3motion \
    --ks-pass "file:$PASSFILE" \
    --min-sdk-version 19 "$WORK/s3-bedroom-motion.apk"
"$TOOLS/apksigner" verify --verbose "$WORK/s3-bedroom-motion.apk"
adb -s 3230cf48843b9027 install -r -g "$WORK/s3-bedroom-motion.apk"
adb -s 3230cf48843b9027 shell pm grant nl.kalenel.s3motion android.permission.CAMERA || true
echo "S3_ONPHONE_APP_INSTALLED"
