#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v7-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

# V7: retain V6's 4 Hz / delta=1 dark-room path, but make a quick walk-by
# require only two positive samples rather than three. At 4 Hz this is ~0.5 s.
s=s.replace('"mode":"dark","delta":1,"changed":0.015,"contour":4.0,"confirm":3',
            '"mode":"dark","delta":1,"changed":0.015,"contour":4.0,"confirm":2')
s=s.replace('FRONTCAM_MOTION_V6 starting; high-sensitivity dark-room motion; no images stored',
            'FRONTCAM_MOTION_V7 starting; fast high-sensitivity dark-room motion; no images stored')
s=s.replace('"version":"frontcam-motion-v6"','"version":"frontcam-motion-v7"')
s=s.replace('FRONTCAM_MOTION_V6 stopped','FRONTCAM_MOTION_V7 stopped')
if 'frontcam-motion-v7' not in s:
    raise SystemExit("V7 patch anchors were not found")
SCRIPT.write_text(s)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(6)
show=subprocess.run(
    ["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service",
     "-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
    text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-v7","backup":str(BACKUP),"service":show,"state":state},indent=2))
