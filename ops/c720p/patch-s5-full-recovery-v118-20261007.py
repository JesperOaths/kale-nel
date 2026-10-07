#!/usr/bin/env python3
from pathlib import Path
import datetime, json, shutil, subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
SCRIPT=BASE/"bin/c720p-s5-usb-bootstrap-watch.sh"
REQ=BASE/"state/tv-surround-recover-once.json"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-full-recovery-v118-{STAMP}"
BACK.mkdir(parents=True,exist_ok=False)
if SCRIPT.exists(): shutil.copy2(SCRIPT,BACK/(SCRIPT.name+".before"))
if REQ.exists(): shutil.copy2(REQ,BACK/(REQ.name+".before"))

SCRIPT.write_text(r'''#!/usr/bin/env bash
set -u
ADB="${ADB:-adb}"
SER="993e96d0"
REQ="/home/jespern/c720p-home-hub/state/tv-surround-recover-once.json"

"$ADB" start-server >/dev/null 2>&1 || true
USB=0
if "$ADB" devices 2>/dev/null | awk -v s="$SER" '$1==s && $2=="device"{ok=1} END{exit(ok?0:1)}'; then
  USB=1
  systemctl --user start c720p-s5-rediscover.service >/dev/null 2>&1 || true
fi

# One-shot task requested by the 2026-10-07 TV/surround repair. It is removed
# only after HTS power-on has been accepted; normal future USB connections do
# not turn media equipment on.
[ -f "$REQ" ] || exit 0

ready=0
for _ in 1 2 3 4 5 6; do
  H="$(curl -sS --max-time 8 http://127.0.0.1:8789/health 2>/dev/null || true)"
  if printf '%s' "$H" | python3 -c 'import json,sys
try:
 d=json.load(sys.stdin)
 ok=bool(d.get("s5_connected") or (d.get("s5_http") or {}).get("ok"))
except Exception: ok=False
raise SystemExit(0 if ok else 1)' 2>/dev/null; then
    ready=1
    break
  fi
  [ "$USB" -eq 1 ] || break
  sleep 2
done
[ "$ready" -eq 1 ] || exit 0

curl -sS --max-time 40 -X POST http://127.0.0.1:8789/grundig-tv/on >/tmp/s5-v118-tv-on.json 2>/dev/null || true
curl -sS --max-time 25 -X POST http://127.0.0.1:8789/grundig-tv/hdmi3-fast >/tmp/s5-v118-hdmi3.json 2>/dev/null || true
HTS="$(curl -sS --max-time 45 -X POST http://127.0.0.1:8789/ht-e6500/ensure-on 2>/dev/null || true)"
printf '%s
' "$HTS" >/tmp/s5-v118-hts-on.json

if printf '%s' "$HTS" | python3 -c 'import json,sys
try: d=json.load(sys.stdin); ok=bool(d.get("ok"))
except Exception: ok=False
raise SystemExit(0 if ok else 1)' 2>/dev/null; then
  curl -sS --max-time 12 -X POST http://127.0.0.1:8790/pipeline/bluetooth-fast >/tmp/s5-v118-pipeline.json 2>/dev/null || true
  rm -f "$REQ"
  logger -t c720p-s5-recovery "TV_SURROUND_RECOVERY_V118=HTS_ON_PIPELINE_STARTED"
fi
exit 0
''',encoding="utf-8")
SCRIPT.chmod(0o755)

REQ.parent.mkdir(parents=True,exist_ok=True)
REQ.write_text(json.dumps({
    "version":"v118",
    "requested_at":datetime.datetime.now().astimezone().isoformat(),
    "goal":"TV on, HDMI3, HT-E6500 on, Bluetooth pipeline",
    "one_shot":True
},indent=2)+"
",encoding="utf-8")

subprocess.run(["bash","-n",str(SCRIPT)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-s5-usb-bootstrap-watch.timer"],check=True)
subprocess.run(["systemctl","--user","start","c720p-s5-usb-bootstrap-watch.service"],check=True)

print("S5_FULL_RECOVERY_V118=OK")
print("BACKUP="+str(BACK))
print("REQUEST_ARMED="+str(REQ.exists()))
print("TIMER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-s5-usb-bootstrap-watch.timer"],capture_output=True,text=True).stdout.strip())
