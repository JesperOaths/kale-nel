#!/usr/bin/env bash
# Download one immutable revision of all APK sources; never mix historical commits.
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub/build/s9-native-security"
REPO="JesperOaths/kale-nel"
REF="$(printenv S9_SECURITY_REF || true)"
test -n "$REF" || REF="main"
ENCODED="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$REF")"
SHA="$(curl -fsSL --retry 3 --connect-timeout 10 --max-time 45 \
  "https://api.github.com/repos/$REPO/commits/$ENCODED" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "INVALID_GITHUB_COMMIT=$SHA" >&2; exit 5; }
mkdir -p "$ROOT/src/nl/kalenel/s9security"
TEMP="$(mktemp -d "$ROOT/.s9-source.XXXXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
for file in CameraActivity CameraService MotionGrid ClipClassifier PreviewJpeg Boot; do
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 45 \
    "https://raw.githubusercontent.com/$REPO/$SHA/ops/c720p/s9-native-security/src/nl/kalenel/s9security/$file.java" \
    -o "$TEMP/$file.java"
  test -s "$TEMP/$file.java"
  grep -Fq "package nl.kalenel.s9security;" "$TEMP/$file.java"
done
curl -fsSL --retry 3 --connect-timeout 10 --max-time 45 \
  "https://raw.githubusercontent.com/$REPO/$SHA/ops/c720p/s9-native-security/AndroidManifest.xml" \
  -o "$TEMP/AndroidManifest.xml"
grep -Fq 'package="nl.kalenel.s9security"' "$TEMP/AndroidManifest.xml"
# Publish only after the complete source set has been fetched and validated.
for file in CameraActivity CameraService MotionGrid ClipClassifier PreviewJpeg Boot; do
  mv -f "$TEMP/$file.java" "$ROOT/src/nl/kalenel/s9security/$file.java"
done
mv -f "$TEMP/AndroidManifest.xml" "$ROOT/AndroidManifest.xml"
printf '%s\n' "$SHA" > "$ROOT/.source-commit"
rm -f "$ROOT/.compiled-commit"
echo "S9_SOURCE_REVISION=$SHA"
