#!/data/data/com.termux/files/usr/bin/bash
# Install a minimal cached-multiplayer release in the NATIVE Termux context.
# No MP3 directory, Solo session, user database, or Android app is modified.
set -euo pipefail
umask 077
APP=/data/data/com.termux/files/home/tune-rush-solo
PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home PATH="$PREFIX/bin:/system/bin" TMPDIR="$PREFIX/tmp"
archive="${1:-}"
if [[ -z "$archive" || ! -s "$archive" || ! -d "$APP" || ! -x "$PREFIX/bin/python3" ]]; then
  echo "Requires existing S21 Termux installation and a package archive argument" >&2
  exit 2
fi
if [[ $(id -u) = 0 ]]; then echo "Refusing to run as root" >&2;exit 2;fi
mkdir -p "$TMPDIR"
if python3 - <<'PY'
import urllib.request
try:
 with urllib.request.urlopen('http://127.0.0.1:8798/api/health',timeout=2) as response:
  if response.status==200: raise SystemExit(0)
except Exception:pass
raise SystemExit(1)
PY
then
  echo "Multiplayer already running. A coordinated restart is required before replacing its files." >&2
  exit 3
fi
work=$(mktemp -d "$APP/.multiplayer-install.XXXXXX")
backup=$(mktemp -d "$APP/.multiplayer-backup.XXXXXX")
chmod 700 "$work" "$backup"
installed=0
rollback(){
  code=$?
  if [[ $code -ne 0 && $installed -eq 1 ]];then
    echo "Install failed; rolling back changed files only." >&2
    for f in multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py; do
      if [[ -f "$backup/$f" ]]; then
        cp -p "$backup/$f" "$APP/$f"
      else
        rm -f "$APP/$f"
      fi
    done
  fi
  rm -rf "$work"
  if [[ $code -eq 0 ]]; then
    printf 'SUCCESS. Changed-file backups retained at %s\n' "$backup"
  else
    echo "Deployment not activated; S21 Solo and cached MP3 library were not changed." >&2
  fi
}
trap rollback EXIT
# Only an exact whitelist of regular code files is allowed in the release.
actual=$(tar -tzf "$archive" | LC_ALL=C sort)
expected=$(printf '%s\n' MANIFEST.sha256 multiplayer.py multiplayer_service.py relay-worker.py start-multiplayer.sh watchdog.py | LC_ALL=C sort)
if [[ "$actual" != "$expected" ]];then echo "Unexpected archive contents" >&2;exit 2;fi
tar -xzf "$archive" -C "$work"
(cd "$work" && sha256sum -c MANIFEST.sha256)
for f in multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py;do
  if [[ ! -f "$work/$f" || -L "$work/$f" ]];then echo "Unsafe archive member" >&2;exit 2;fi
done
"$PREFIX/bin/python3" -m py_compile "$work/multiplayer.py" "$work/multiplayer_service.py" "$work/watchdog.py" "$work/relay-worker.py"
"$PREFIX/bin/python3" - <<PY
import sys
sys.path.insert(0,"$APP")
from persistent_music_library import LIBRARY_ROOT
from pathlib import Path
p=Path(LIBRARY_ROOT)/"library.sqlite3"
if not p.is_file(): raise SystemExit("S21 permanent library missing; refusing new game activation")
print("Permanent library verified; leaving its files untouched.")
PY
for f in multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py;do
  if [[ -e "$APP/$f" ]];then cp -p "$APP/$f" "$backup/$f";fi
done
installed=1
for f in multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py;do
  cp "$work/$f" "$APP/.$f.deploying"
  chmod 600 "$APP/.$f.deploying"
  mv -f "$APP/.$f.deploying" "$APP/$f"
done
chmod 700 "$APP/start-multiplayer.sh"
# Only the new port 8798 is started. Running Solo 8797 and its worker stay up.
nohup "$APP/start-multiplayer.sh" > "$APP/multiplayer.out.log" 2>&1 < /dev/null &
pid=$!
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10;do
  if "$PREFIX/bin/python3" - <<'PY'
import json,urllib.request
try:
 with urllib.request.urlopen('http://127.0.0.1:8798/api/health',timeout=2) as response:
  o=json.load(response)
  assert o.get('ready') is True and o.get('source')=='persistent-library'
except Exception:raise SystemExit(1)
PY
  then ready=1;break;fi
  sleep 1
done
if [[ $ready -ne 1 ]];then
  kill "$pid" 2>/dev/null || true
  echo "Port 8798 did not become healthy. Check existing Solo is still running." >&2
  exit 1
fi
echo "S21 cached multiplayer is healthy on 8798. Solo 8797 left unchanged."
echo "Updated watchdog code will supervise the new service when its current process next restarts."
