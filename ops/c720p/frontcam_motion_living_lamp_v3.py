#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, py_compile, shutil, subprocess, time, json
HOME=pathlib.Path("/home/jespern")
SCRIPT=HOME/"c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py"
STATE=HOME/"c720p-home-hub/state/frontcam-motion-living-lamp.json"
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup=HOME/"c720p-backups"/f"frontcam-motion-lamp-v3-{stamp}"
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,backup/(SCRIPT.name+".before"))
s=SCRIPT.read_text()
if "FRONTCAM_MOTION_V2" not in s and "frontcam-motion-v2" not in s:
    raise SystemExit("expected V2 detector not found")
s=s.replace("SETTLE_SECONDS=2.5","SETTLE_SECONDS=8.0")
s=s.replace('"version":"frontcam-motion-v2"','"version":"frontcam-motion-v3"')
s=s.replace("FRONTCAM_MOTION_V2 starting; adaptive dark-room detection; no images stored",
            "FRONTCAM_MOTION_V3 starting; dark-room detection with 8s light-transition quarantine; no images stored")
# During a known lamp/exposure transition, converge to the new background fast.
s=s.replace("cv2.accumulateWeighted(g,bg,BACKGROUND_ALPHA_QUIET)\n        else:",
            "cv2.accumulateWeighted(g,bg,0.35)\n        else:",1)
SCRIPT.write_text(s)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(10)
service=subprocess.run(["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service",
                        "-p","ActiveState","-p","MainPID","-p","MemoryCurrent","-p","CPUUsageNSec"],
                       text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try:state=json.loads(STATE.read_text())
except Exception as e:state={"read_error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-lamp-v3","backup":str(backup),
 "change":"8s light-change quarantine with fast background convergence",
 "service":service,"state":state},indent=2))
