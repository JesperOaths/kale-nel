#!/usr/bin/env python3
"""Adjust only camera-owned living-room timer from 5 to 10 minutes.

Preserve S3 bedroom 5m timeout, manual ownership, all trigger and motion
constraints. Validate Home Assistant config, restart with rollback.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import time
import datetime

AUT=Path("/opt/homeassistant/config/automations.yaml")
BASE=Path("/home/jespern/c720p-backups")
LIVING="- id: c720p_frontcam_motion_living_lamp_v1"
LIVING_END="# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1"
BEDROOM="- id: c720p_s3_bedroom_spots_v1"
BEDROOM_END="# END C720P_S3_BEDROOM_SPOTS_V1"

def segment(src,start,end):
 if src.count(start)!=1 or src.count(end)!=1:
  raise RuntimeError("automation_boundary_mismatch")
 i=src.index(start)
 j=src.index(end,i)+len(end)
 return src[i:j],i,j

def patch(original):
 living,i,j=segment(original,LIVING,LIVING_END)
 bedroom,_,_=segment(original,BEDROOM,BEDROOM_END)
 if bedroom.count('duration: "00:05:00"')!=2:
  raise RuntimeError("bedroom_five_minute_contract_changed")
 if "input_boolean.c720p_s3_bedroom_camera_owned" not in bedroom:
  raise RuntimeError("bedroom_manual_ownership_missing")
 if 'duration: "00:10:00"' in living:
  if living.count('duration: "00:10:00"')!=2:raise RuntimeError("partial_ten_minute_install")
  return original,True
 if living.count('duration: "00:05:00"')!=2:
  raise RuntimeError("living_timer_unexpected")
 if "input_boolean.c720p_living_camera_owned" not in living:
  raise RuntimeError("living_manual_ownership_missing")
 new_living=living.replace('duration: "00:05:00"','duration: "00:10:00"')
 return original[:i]+new_living+original[j:],False

def run(args,timeout=60):
 return subprocess.run(args,capture_output=True,text=True,timeout=timeout)

def check_config():
 p=run(["docker","exec","homeassistant","python","-m","homeassistant",
        "--script","check_config","-c","/config"],timeout=170)
 return p.returncode,(p.stdout+p.stderr)[-600:]

def restart():
 p=run(["docker","restart","homeassistant"],timeout=100)
 if p.returncode:raise RuntimeError("homeassistant_restart_failed")
 for _ in range(40):
  r=run(["curl","-s","-o","/dev/null","-w","%{http_code}",
         "--max-time","3","http://127.0.0.1:8123/"],timeout=6)
  if r.stdout.strip() in ("200","302","401"):return
  time.sleep(3)
 raise RuntimeError("homeassistant_not_available_after_restart")

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--apply",action="store_true")
 a=p.parse_args()
 old=AUT.read_text()
 changed,already=patch(old)
 report={"status":"already_installed" if already else "ready",
         "living_minutes":10,"bedroom_minutes":5,
         "manual_ownership_preserved":True,"mode":"apply" if a.apply else "check"}
 if not a.apply or already:
  print("C720P_LIGHT_TIMERS_V2 "+json.dumps(report),flush=True)
  return
 back=BASE/("camera-light-timers-"+datetime.datetime.now().strftime("%Y%m%dT%H%M%S"))
 back.mkdir(parents=True,exist_ok=False)
 shutil.copy2(AUT,back/"automations.before.yaml")
 stage=AUT.with_suffix(".yaml.10m-stage")
 stage.write_text(changed)
 stage.chmod(AUT.stat().st_mode & 0o777)
 stage.replace(AUT)
 try:
  code,detail=check_config()
  if code:raise RuntimeError("HA_config_invalid:"+detail[-200:])
  restart()
  actual=AUT.read_text()
  if actual!=changed:raise RuntimeError("config_changed_after_restart")
  _,check=patch(actual)
  if not check:raise RuntimeError("timer_patch_not_active")
 except Exception:
  shutil.copy2(back/"automations.before.yaml",AUT)
  restart()
  raise
 report.update({"status":"installed","config_check":"pass",
                "HA_restart":"healthy","backup":str(back)})
 print("C720P_LIGHT_TIMERS_V2 "+json.dumps(report),flush=True)

if __name__=="__main__":main()
