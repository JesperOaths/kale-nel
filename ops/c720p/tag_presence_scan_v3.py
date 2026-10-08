#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, pathlib, py_compile, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
SCRIPT=HOME/"c720p-home-hub/bin/c720p-tag-presence-daemon.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"tag-presence-scan-v3-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))

s=SCRIPT.read_text()
old="""    child.stdin.write('scan le\\n'); child.stdin.flush()
"""
new="""    # On this BlueZ/bluetoothctl build, 'scan le' only selects the LE
    # discovery filter; it does not actually begin discovery. Explicitly issue
    # 'scan on' afterwards. The previous daemon looked healthy but the
    # controller remained Discovering=no and therefore saw no tracker packets.
    child.stdin.write('scan le\\n')
    child.stdin.write('scan on\\n')
    child.stdin.flush()
"""
if old not in s:
    raise SystemExit("scan command anchor missing")
s=s.replace(old,new,1)
s=s.replace("'version':'c720p-tag-presence-v2-continuous'",
            "'version':'c720p-tag-presence-v3-scan-on'")
SCRIPT.write_text(s)
py_compile.compile(str(SCRIPT),doraise=True)

subprocess.run(["systemctl","--user","restart","c720p-tag-presence.service"],check=True,timeout=30)
time.sleep(6)
show=subprocess.run(["bluetoothctl","show"],text=True,capture_output=True,timeout=10).stdout
discovering=None
for line in show.splitlines():
    if "Discovering:" in line:
        discovering=line.split(":",1)[1].strip().lower()=="yes"
time.sleep(18)
state={}
try: state=json.loads(pathlib.Path("/opt/homeassistant/config/www/c720p-tag-presence.json").read_text())
except Exception as e: state={"error":str(e)}
log=subprocess.run(["tail","-40",str(HOME/"c720p-home-hub/logs/c720p-tag-presence.log")],
                   text=True,capture_output=True,timeout=10).stdout
svc=subprocess.run(["systemctl","--user","show","c720p-tag-presence.service",
                    "-p","ActiveState","-p","SubState","-p","MainPID","-p","NRestarts"],
                   text=True,capture_output=True,timeout=10).stdout.strip()
print(json.dumps({
    "ok":True,
    "version":"tag-presence-v3-scan-on",
    "backup":str(BACKUP),
    "controller_discovering_after_start":discovering,
    "service":svc,
    "state":state,
    "recent_log":log,
},indent=2))
