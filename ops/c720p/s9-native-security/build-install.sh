#!/usr/bin/env bash
# Build by default; only install to a device that has NEVER hosted this package.
# Existing installs (including stopped ones) must use the backup/rollback upgrader.
set -Eeuo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
"$BASE/compile-only.sh"
"$BASE/package-only.sh"
if [[ "$(printenv S9_INSTALL_SHADOW || true)" != "1" ]]; then
  echo "APK_BUILT_NOT_INSTALLED: use safe-night-guard-upgrade.py for the live S9+"
  exit 0
fi
PHONE="192.168.178.250:5555"
adb connect "$PHONE"
# Even a stopped installed package may auto-start on MY_PACKAGE_REPLACED.
if adb -s "$PHONE" shell pm path nl.kalenel.s9security | grep -Fq 'package:'; then
  echo "REFUSING_SHADOW_INSTALL_EXISTING_NATIVE_PACKAGE" >&2
  exit 4
fi
APK="$HOME/c720p-home-hub/build/s9-native-security/s9-native-security.apk"
adb -s "$PHONE" install -g "$APK"
echo "NEW_SHADOW_APP_INSTALLED_NOT_ARMED"
