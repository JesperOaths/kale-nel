#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNITS=HOME/".config/systemd/user"
SCRIPT=BIN/"c720p-s5-usb-bootstrap-watch.sh"
SERVICE=UNITS/"c720p-s5-usb-bootstrap-watch.service"
TIMER=UNITS/"c720p-s5-usb-bootstrap-watch.timer"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-usb-watch-v116-{STAMP}"
BACK.mkdir(parents=True,exist_ok=False)

for p in (SCRIPT,SERVICE,TIMER):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

SCRIPT.write_text(r'''#!/usr/bin/env bash
set -euo pipefail
ADB="${ADB:-adb}"
SER="993e96d0"
"$ADB" start-server >/dev/null 2>&1 || true
if "$ADB" devices 2>/dev/null | awk -v s="$SER" '$1==s && $2=="device"{ok=1} END{exit(ok?0:1)}'; then
  systemctl --user start c720p-s5-rediscover.service
fi
''',encoding="utf-8")
SCRIPT.chmod(0o755)

SERVICE.write_text('''[Unit]
Description=Fast trusted Galaxy S5 USB recovery trigger
After=default.target

[Service]
Type=oneshot
ExecStart=%h/c720p-home-hub/bin/c720p-s5-usb-bootstrap-watch.sh
''',encoding="utf-8")

TIMER.write_text('''[Unit]
Description=Watch for trusted Galaxy S5 USB recovery

[Timer]
OnBootSec=15s
OnUnitActiveSec=20s
AccuracySec=3s
Persistent=true
Unit=c720p-s5-usb-bootstrap-watch.service

[Install]
WantedBy=timers.target
''',encoding="utf-8")

subprocess.run(["bash","-n",str(SCRIPT)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now",TIMER.name],check=True)
subprocess.run(["systemctl","--user","start",SERVICE.name],check=True)

print("S5_USB_WATCH_V116=OK")
print("BACKUP="+str(BACK))
print("TIMER_ACTIVE="+subprocess.run(["systemctl","--user","is-active",TIMER.name],capture_output=True,text=True).stdout.strip())
print("TIMER_ENABLED="+subprocess.run(["systemctl","--user","is-enabled",TIMER.name],capture_output=True,text=True).stdout.strip())
