#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v8-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V7 starting; fast high-sensitivity dark-room motion; no images stored',
            'FRONTCAM_MOTION_V8 starting; one-frame strong dark walk-by trigger; no images stored')
s=s.replace('"version":"frontcam-motion-v7"','"version":"frontcam-motion-v8"')
s=s.replace('FRONTCAM_MOTION_V7 stopped','FRONTCAM_MOTION_V8 stopped')

old='''        confirmed=bool(candidate and candidate_streak>=th["confirm"])
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS:
            armed=True
'''
new='''        # V8 fast dark-room path: a clearly coherent dark-scene movement may
        # trigger from a single 4 Hz sample. This specifically catches a person
        # walking briskly past the laptop. Lighting transitions are already
        # quarantined above, so they cannot take this shortcut.
        strong_dark_motion=bool(
            th["mode"]=="dark"
            and not abrupt
            and now>=transition_until
            and temporal_changed>=0.35
            and temporal_largest>=15.0
            and temporal_changed<35.0)
        confirmed=bool((candidate and candidate_streak>=th["confirm"]) or strong_dark_motion)
        if strong_dark_motion:
            last_motion_at=now
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS:
            armed=True
'''
if old not in s:
    raise SystemExit("V8 confirm anchor missing")
s=s.replace(old,new,1)

old2='''            "candidate":candidate,
            "confirmed_motion":confirmed,"candidate_streak":candidate_streak,
'''
new2='''            "candidate":candidate,
            "strong_dark_motion":strong_dark_motion,
            "confirmed_motion":confirmed,"candidate_streak":candidate_streak,
'''
if old2 not in s:
    raise SystemExit("V8 telemetry anchor missing")
s=s.replace(old2,new2,1)

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
print(json.dumps({"ok":True,"version":"frontcam-motion-v8","backup":str(BACKUP),"service":show,"state":state},indent=2))
