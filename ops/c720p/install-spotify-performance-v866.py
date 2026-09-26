#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import os, shutil, subprocess, time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
STATE=BASE/"state"
LOGS=BASE/"logs"
UNITDIR=HOME/".config/systemd/user"
SPOTIFY_PROFILE=HOME/".config/c720p-spotify-chromium"
LAUNCHER=BIN/"c720p-open-spotify.sh"
PERF=BIN/"c720p-spotify-performance.sh"
WATCH=BIN/"c720p-spotify-performance-watch.sh"
UNIT=UNITDIR/"c720p-spotify-browser.service"

for p in (BIN,STATE,LOGS,UNITDIR,SPOTIFY_PROFILE): p.mkdir(parents=True,exist_ok=True)

def run(args, check=False, timeout=30):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout,check=False)
    if check and p.returncode:
        raise RuntimeError(f"{args}: {p.returncode}: {p.stdout[-1200:]}")
    return p

browser=next((p for p in ("/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome") if Path(p).exists()),None)
if not browser:
    raise SystemExit("spotify_browser_not_found")

stamp=time.strftime("%Y%m%d-%H%M%S")
if LAUNCHER.exists():
    backup=LAUNCHER.with_name(LAUNCHER.name+f".before-v866-{stamp}")
    shutil.copy2(LAUNCHER,backup)

perf=r'''#!/usr/bin/env bash
set -u
STATE=/home/jespern/c720p-home-hub/state/spotify-performance-active

set_weight(){
  local unit="$1" cpu="$2" io="$3"
  systemctl --user status "$unit" >/dev/null 2>&1 || return 0
  systemctl --user set-property --runtime "$unit" "CPUWeight=$cpu" "IOWeight=$io" >/dev/null 2>&1 || true
}
case "${1:-status}" in
  on)
    : > "$STATE"
    # Spotify is interactive; background dashboard/voice/archive work must yield
    # CPU and I/O while it is open. Recording remains active.
    set_weight c720p-home-hub-kiosk.service 25 25
    set_weight c720p-openwakeword-v53e.service 100 100
    set_weight c720p-drive-security-archive.service 10 10
    set_weight c720p-security-web.service 50 50
    set_weight c720p-security-tunnel.service 50 50
    set_weight c720p-frontyard-security-new.service 100 100
    echo RESULT=SPOTIFY_PERFORMANCE_ON
    ;;
  off)
    rm -f "$STATE"
    set_weight c720p-home-hub-kiosk.service 100 100
    # Restore the deliberately high normal voice priority from 95-voice-priority-v56.conf.
    set_weight c720p-openwakeword-v53e.service 10000 1000
    set_weight c720p-drive-security-archive.service 100 100
    set_weight c720p-security-web.service 100 100
    set_weight c720p-security-tunnel.service 100 100
    set_weight c720p-frontyard-security-new.service 100 100
    echo RESULT=SPOTIFY_PERFORMANCE_OFF
    ;;
  status)
    if [ -f "$STATE" ]; then echo active; else echo inactive; fi
    ;;
  *) exit 2;;
esac
'''
PERF.write_text(perf); PERF.chmod(0o755)

watch=r'''#!/usr/bin/env bash
set -u
PROFILE=/home/jespern/.config/c720p-spotify-chromium
PERF=/home/jespern/c720p-home-hub/bin/c720p-spotify-performance.sh
sleep 6
while pgrep -f "chromium.*--user-data-dir=$PROFILE" >/dev/null 2>&1; do sleep 5; done
"$PERF" off >/dev/null 2>&1 || true
'''
WATCH.write_text(watch); WATCH.chmod(0o755)

unit=f'''[Unit]
Description=C720P Spotify Chromium app with interactive CPU priority
After=graphical-session.target pulseaudio.service c720p-home-hub-kiosk.service
Wants=pulseaudio.service

[Service]
Type=simple
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/jespern/.Xauthority
ExecStartPre={PERF} on
ExecStart={browser} --user-data-dir={SPOTIFY_PROFILE} --app=https://open.spotify.com/ --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-pings --media-router=0 --disable-dev-shm-usage --enable-gpu-rasterization --num-raster-threads=2 --use-gl=angle --use-angle=gl --disable-features=Vulkan,UseSkiaRenderer,InfiniteSessionRestore,Translate --disk-cache-size=33554432 --media-cache-size=67108864 --window-position=683,0 --window-size=683,768
ExecStopPost={PERF} off
Restart=no
KillMode=mixed
CPUWeight=10000
IOWeight=1000

[Install]
WantedBy=default.target
'''
UNIT.write_text(unit); UNIT.chmod(0o644)

launcher=r'''#!/usr/bin/env bash
set -u
export DISPLAY=:0
export XAUTHORITY=/home/jespern/.Xauthority
PROFILE=/home/jespern/.config/c720p-spotify-chromium
URL=https://open.spotify.com/
CONNECT=/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh
PERF=/home/jespern/c720p-home-hub/bin/c720p-spotify-performance.sh
WATCH=/home/jespern/c720p-home-hub/bin/c720p-spotify-performance-watch.sh
LOG=/home/jespern/c720p-home-hub/logs/spotify-open.log
mkdir -p "$PROFILE" "$(dirname "$LOG")"

spotify_window() {
  command -v wmctrl >/dev/null 2>&1 || return 1
  wmctrl -lx 2>/dev/null | awk 'BEGIN{IGNORECASE=1} /open\.spotify\.com\.Chromium/{print $1; found=1; exit} /spotify|open\.spotify\.com/{if(!fallback)fallback=$1} END{if(!found&&fallback)print fallback}'
}
place_window() {
  local id="$1"
  [ -n "$id" ] || return 0
  wmctrl -ia "$id" >/dev/null 2>&1 || true
  wmctrl -ir "$id" -b remove,maximized_vert,maximized_horz >/dev/null 2>&1 || true
  wmctrl -ir "$id" -e 0,683,0,683,768 >/dev/null 2>&1 || true
}
audio_best_effort() {
  [ -x "$CONNECT" ] || return 0
  (
    echo "$(date -Is) AUDIO_RETRY_START"
    if timeout 125 "$CONNECT"; then
      echo "$(date -Is) AUDIO_READY"
    else
      echo "$(date -Is) AUDIO_PENDING_OR_FAILED"
    fi
  ) >>"$LOG" 2>&1 &
}
legacy_restore_watch() {
  systemctl --user reset-failed c720p-spotify-performance-watch.service >/dev/null 2>&1 || true
  systemd-run --user --unit=c720p-spotify-performance-watch --collect "$WATCH" >/dev/null 2>&1 || true
}

id="$(spotify_window || true)"
if [ -n "$id" ]; then
  "$PERF" on >/dev/null 2>&1 || true
  if ! systemctl --user is-active --quiet c720p-spotify-browser.service; then legacy_restore_watch; fi
  place_window "$id"
  audio_best_effort
  echo "RESULT=SPOTIFY_FOCUSED_PERFORMANCE_AUDIO_BEST_EFFORT"
  exit 0
fi

"$PERF" on >/dev/null 2>&1 || true
systemctl --user reset-failed c720p-spotify-browser.service >/dev/null 2>&1 || true
if ! systemctl --user start --no-block c720p-spotify-browser.service; then
  "$PERF" off >/dev/null 2>&1 || true
  echo "RESULT=SPOTIFY_SERVICE_START_FAILED" >&2
  exit 4
fi

for _ in $(seq 1 40); do
  sleep 0.25
  id="$(spotify_window || true)"
  if [ -n "$id" ]; then
    place_window "$id"
    audio_best_effort
    echo "RESULT=SPOTIFY_OPENED_PERFORMANCE_AUDIO_BEST_EFFORT"
    exit 0
  fi
done

audio_best_effort
echo "RESULT=SPOTIFY_LAUNCHED_PERFORMANCE_WINDOW_PENDING"
exit 0
'''
LAUNCHER.write_text(launcher); LAUNCHER.chmod(0o755)

# OAuth setup is complete; close only the Google Cloud Firefox session created for that work.
subprocess.run(["bash","-lc","pkill -TERM -f 'firefox-esr .*console\.cloud\.google\.com/auth/' 2>/dev/null || true"],check=False)

# S3 is retired. Masking prevents the return/failsafe jobs from resurrecting its recorder.
subprocess.run(["systemctl","--user","disable","--now","c720p-s3-profile-guard.timer"],check=False)
subprocess.run(["systemctl","--user","disable","--now","c720p-s3-battery-camera-gate.timer"],check=False)
subprocess.run(["systemctl","--user","mask","--now","c720p-frontyard-security.service"],check=False)

run(["bash","-n",str(PERF)],check=True)
run(["bash","-n",str(WATCH)],check=True)
run(["bash","-n",str(LAUNCHER)],check=True)
run(["systemctl","--user","daemon-reload"],check=True)
verify=run(["systemd-analyze","--user","verify",str(UNIT)],timeout=20)
if verify.returncode:
    raise RuntimeError("spotify_service_verify_failed: "+verify.stdout[-1600:])

# Prove the dynamic priority profile can be applied and restored without opening Spotify.
on=run([str(PERF),"on"],check=True)
props_on={}
for u in ("c720p-home-hub-kiosk.service","c720p-openwakeword-v53e.service","c720p-drive-security-archive.service"):
    props_on[u]=run(["systemctl","--user","show",u,"-p","CPUWeight","-p","IOWeight","--value"]).stdout.strip().replace("\n","/")
off=run([str(PERF),"off"],check=True)
props_off={}
for u in ("c720p-home-hub-kiosk.service","c720p-openwakeword-v53e.service","c720p-drive-security-archive.service"):
    props_off[u]=run(["systemctl","--user","show",u,"-p","CPUWeight","-p","IOWeight","--value"]).stdout.strip().replace("\n","/")

print("BROWSER="+browser)
print("S3_STATE="+run(["systemctl","--user","is-active","c720p-frontyard-security.service"]).stdout.strip())
print("S3_ENABLED="+run(["systemctl","--user","is-enabled","c720p-frontyard-security.service"]).stdout.strip())
print("FIREFOX_OAUTH_COUNT="+run(["bash","-lc","pgrep -af 'firefox-esr .*console\.cloud\.google\.com/auth/' | wc -l"]).stdout.strip())
print("PROFILE_ON="+repr(props_on))
print("PROFILE_OFF="+repr(props_off))
print("RESULT=SPOTIFY_PERFORMANCE_V866_INSTALLED")
