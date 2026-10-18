#!/usr/bin/env bash
set -euo pipefail

URL="${C720P_KIOSK_URL:-http://127.0.0.1:8123/c720p-hub/home}"
PROFILE="/home/jespern/.config/c720p-kiosk-chromium"
SCALE_FILE="/home/jespern/c720p-home-hub/kiosk-scale.conf"
LANGUAGE="${C720P_KIOSK_LANG:-nl-NL}"
# C720P_KIOSK_GPU_COMPOSITING_V1
export LIBVA_DRIVER_NAME="${LIBVA_DRIVER_NAME:-i965}"

# Default zoom if no config exists.
SCALE="0.90"

if [ -f "$SCALE_FILE" ]; then
  SCALE="$(cat "$SCALE_FILE" | tr -d '[:space:]')"
fi

mkdir -p "$PROFILE"
rm -rf "$PROFILE/Default/Sessions" "$PROFILE"/Singleton* "$PROFILE/Crashpad"/pending "$PROFILE/BrowserMetrics" 2>/dev/null || true
python3 - "$PROFILE/Default/Preferences" "$LANGUAGE" <<'PY' || true
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
language = sys.argv[2]
path.parent.mkdir(parents=True, exist_ok=True)
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {}
data.setdefault("intl", {})["accept_languages"] = f"{language},nl,en-US,en"
tmp = path.with_suffix(".tmp")
tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
tmp.replace(path)
PY

echo "$(date -Is) Starting C720P kiosk URL=$URL SCALE=$SCALE LANG=$LANGUAGE" >> /tmp/c720p-kiosk.log

# Keep the screen awake.
xset s off || true
xset -dpms || true
xset s noblank || true
/home/jespern/c720p-home-hub/bin/c720p-touch-recover.sh || true

# Hide cursor after idle.
pkill -f "unclutter.*idle" 2>/dev/null || true
unclutter -idle 2 >/dev/null 2>&1 &

# Stop old kiosk browser windows from stacking.
pkill -f "chromium.*c720p-kiosk-chromium" 2>/dev/null || true
pkill -f "chrome.*c720p-kiosk-chromium" 2>/dev/null || true

sleep 1

# C720P post-start compositor self-heal: Haswell/Xfwm can map a white Chromium surface
# if the kiosk starts after a lid/display resume. Toggle compositing only after Chromium
# has had time to map its full-screen window, then leave compositing disabled.
(
  sleep 8
  DISPLAY=:0 xfconf-query -c xfwm4 -p /general/use_compositing -s true >/dev/null 2>&1 || true
  sleep 1
  DISPLAY=:0 xfconf-query -c xfwm4 -p /general/use_compositing -s false >/dev/null 2>&1 || true
  DISPLAY=:0 xrefresh >/dev/null 2>&1 || true
  WIN=$(DISPLAY=:0 xdotool search --onlyvisible --class chromium 2>/dev/null | tail -1 || true)
  if [ -n "$WIN" ]; then
    DISPLAY=:0 xdotool windowraise "$WIN" windowactivate "$WIN" >/dev/null 2>&1 || true
  fi
) &

CHROME_BIN=""
if command -v chromium >/dev/null 2>&1; then
  CHROME_BIN="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN="chromium-browser"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME_BIN="google-chrome"
else
  echo "ERROR: No Chromium/Chrome browser found." | tee -a /tmp/c720p-kiosk.log
  exit 1
fi

exec "$CHROME_BIN" \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --num-raster-threads=2 \
  --use-gl=angle \
  --use-angle=gl \
  --disable-metrics \
  --disk-cache-size=67108864 \
  --media-cache-size=33554432 \
  --disable-features=Vulkan,UseSkiaRenderer,InfiniteSessionRestore \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --host-resolver-rules="MAP homeassistant.local 192.168.178.141" \
  --user-data-dir="$PROFILE" \
  --password-store=basic \
  --lang="$LANGUAGE" \
  --accept-lang="$LANGUAGE,nl,en-US,en" \
  --kiosk "$URL" \
  --force-device-scale-factor="$SCALE" \
  --high-dpi-support=1 \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --restore-last-session=false \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --no-first-run \
  --no-default-browser-check \
  --start-maximized

