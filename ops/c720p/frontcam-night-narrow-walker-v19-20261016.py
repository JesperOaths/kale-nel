#!/usr/bin/env python3
"""C720P V19: recover detection of narrow dark-room walkers without
reintroducing historical night noise or exposure-transition false triggers.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import os
import shutil
import subprocess
import time

SOURCE=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
STATE=Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json")
BACKUP=Path("/home/jespern/c720p-backups/frontcam-v19-narrow-walkers/v18-original.py")
SERVICE="c720p-frontcam-motion-living-lamp.service"
V18_SHA="394f9dba0e74a50766f73c92bc0ac8ce71d5bbfbae368d47d99dee97852f1695"
MARKER="NIGHT_NARROW_WALKER_V19_20261016"
OLD="""def night_lamp_shape_gate(bbox, area, changed, streak, displacement, fill):
    if not bbox:
        return False
    x, y, w, h = bbox
    return bool(
        w >= 14 and h >= 16
        and area >= 80.0 and changed >= 0.40
        and streak >= 3 and displacement >= 3.0
        and fill >= 0.08
        and not (x <= 2 and w < 22)
    )"""
NEW="""# NIGHT_NARROW_WALKER_V19_20261016
def night_lamp_shape_gate(bbox, area, changed, streak, displacement, fill):
    if not bbox:
        return False
    x, y, w, h = bbox
    # Existing V17 standard gate is unchanged, including edge rejection.
    standard=bool(
        w >= 14 and h >= 16
        and area >= 80.0 and changed >= 0.40
        and streak >= 3 and displacement >= 3.0
        and fill >= 0.08
        and not (x <= 2 and w < 22)
    )
    # Additional, tightly localized silhouette: tall/narrow walking motion
    # previously rejected only because width was less than 14 pixels.
    slender=bool(
        10 <= w < 14 and h >= 23
        and area >= 70.0 and changed >= 0.25
        and streak >= 4 and displacement >= 4.5
        and fill >= 0.10 and x > 2 and x+w < 158
    )
    return standard or slender"""

def new_source(original):
 if MARKER in original:
  return original,True
 if hashlib.sha256(original.encode()).hexdigest()!=V18_SHA:
  raise RuntimeError("source_sha_not_verified_current_v18")
 if original.count(OLD)!=1:raise RuntimeError("night_gate_unknown")
 if "night_motion_source_ok(source,in_transition_guard)" not in original:
  raise RuntimeError("transition_veto_not_present")
 if original.count('"frontcam-motion-v18"')<1:
  raise RuntimeError("v18_version_missing")
 updated=original.replace(OLD,NEW,1).replace(
   '"frontcam-motion-v18"','"frontcam-motion-v19"')
 compile(updated,str(SOURCE),"exec")
 return updated,False

def tests(s):
 tree=ast.parse(s)
 fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)
         and n.name=="night_lamp_shape_gate")
 scope={}
 exec(compile(ast.Module(body=[fn],type_ignores=[]),"<night-shape>","exec"),scope)
 f=scope["night_lamp_shape_gate"]
 positive=[
  ((40,30,28,36),260,2.2,4,8,.26),
  ((35,42,16,22),92,.81,4,4,.26),
  ((48,36,11,29),82,.35,4,6,.16),
  ((62,34,12,27),80,.29,5,6,.15),
 ]
 negatives=[
  ((80,99,9,7),26,.59,4,5,.16),
  ((70,98,17,14),146,.90,4,4,.35),
  ((7,71,9,10),36,2.09,6,6,.40),
  ((0,71,13,21),64,2.5,6,6,.23),
  ((0,76,10,9),38,2.57,6,6,.42),
  ((11,68,10,19),47,2.22,6,6,.24),
  ((0,80,12,35),140,1.2,6,7,.2),
 ]
 if not all(f(*v) for v in positive):raise RuntimeError("dark_walker_regression")
 if any(f(*v) for v in negatives):raise RuntimeError("false_night_regression")
 if 'return {"mode":"normal","delta":12,"changed":0.30,"contour":60.0,"confirm":2}' not in s:
  raise RuntimeError("V18_normal_profile_changed")
 if 'night_motion_source_ok(source,in_transition_guard)' not in s:
  raise RuntimeError("V18_transition_veto_changed")
 return {"positive_walkers":len(positive),"false_rejected":len(negatives)}

def is_active():
 try:
  p=subprocess.run(["systemctl","--user","is-active",SERVICE],
    capture_output=True,text=True,timeout=20)
  return p.returncode==0 and p.stdout.strip()=="active"
 except subprocess.TimeoutExpired:
  return False

def restart():
 p=subprocess.run(["systemctl","--user","restart",SERVICE],
  capture_output=True,text=True,timeout=20)
 if p.returncode:raise RuntimeError("frontcam_restart_failed")

def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 a=p.parse_args()
 old=SOURCE.read_text()
 new,installed=new_source(old)
 test=tests(new)
 report={"mode":"apply" if a.apply else "check",
         "status":"already_installed" if installed else "ready",
         "synthetic_tests":test,"normal_V18_preserved":True,
         "transition_false_trigger_guard_preserved":True}
 if not a.apply or installed:
  print("C720P_FRONTCAM_V19 "+json.dumps(report),flush=True);return
 if not is_active():raise RuntimeError("frontcam_not_active_before_update")
 BACKUP.parent.mkdir(parents=True,exist_ok=True)
 if BACKUP.exists() and hashlib.sha256(BACKUP.read_bytes()).hexdigest()!=V18_SHA:
  raise RuntimeError("rollback_copy_conflicts")
 if not BACKUP.exists():shutil.copy2(SOURCE,BACKUP)
 stage=SOURCE.with_suffix(".py.v19-new")
 stage.write_text(new)
 os.chmod(stage,SOURCE.stat().st_mode&0o777)
 begin=time.time()
 stage.replace(SOURCE)
 try:
  restart()
  valid=0;last=0.
  deadline=time.monotonic()+85.
  while time.monotonic()<deadline:
   try:d=json.loads(STATE.read_text())
   except (OSError,ValueError):d={}
   stamp=float(d.get("updated_at") or 0)
   # Fresh status updates from the camera process are stronger than
   # repeated systemctl D-Bus round trips on this slow Chromebook.
   healthy=(d.get("version")=="frontcam-motion-v19"
     and d.get("ok") is True and d.get("camera_failures")==0
     and stamp>begin and time.time()-stamp<=7)
   if healthy and stamp>last:
    valid+=1;last=stamp
    if valid>=2:break
   time.sleep(1.5)
  if valid<2:raise RuntimeError("v19_camera_not_healthy_after_restart")
 except Exception:
  shutil.copy2(BACKUP,SOURCE)
  restart()
  raise
 report.update({"status":"installed","service_active":True,
                "fresh_camera_samples":valid,"backup":str(BACKUP)})
 print("C720P_FRONTCAM_V19 "+json.dumps(report),flush=True)
if __name__=="__main__":main()
