#!/usr/bin/env python3
"""Read-only S3 v8 motion / ambient-light health snapshot for Home Assistant.

The S3 retains all camera processing. This reads tiny diagnostic counters and
never captures image/audio, restarts the app, or changes lighting. Keeps last
known status even if ADB is temporarily disconnected, but flags it stale.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import time

SERIAL="192.168.178.47:5555"
WWW=Path("/opt/homeassistant/config/www")
OUT=WWW/"s3-motion-health.json"
USERSTATE=Path("/home/jespern/c720p-home-hub/state/s3-motion-health.json")
def adb(*args):
 p=subprocess.run(["adb","-s",SERIAL,*args],capture_output=True,
                  text=True,timeout=17)
 if p.returncode:
  raise RuntimeError("S3 ADB diagnostic read unavailable")
 return p.stdout
def number(s,name):
 m=re.search(r"(?m)^\s*"+re.escape(name)+r":\s*([0-9]+)\s*$",s)
 return int(m.group(1)) if m else None
def parse():
 now=time.time()
 logs=adb("logcat","-d","-v","epoch","-s","S3MOTION:I","*:S")
 hearts=[x for x in logs.splitlines() if "S3MOTION: HEARTBEAT session=" in x]
 cams=[x for x in logs.splitlines() if "S3MOTION: MOTION session=" in x]
 if not hearts: raise RuntimeError("No S3 motion heartbeats found")
 latest=hearts[-1]
 ts=re.search(r"^\s*([0-9]{10}\.[0-9]+)\s+",latest)
 if not ts: raise RuntimeError("S3 log timestamp unavailable")
 def tag(key):
  m=re.search(r"\b"+re.escape(key)+r"=([^ ]+)",latest)
  return m.group(1) if m else None
 htime=float(ts.group(1))
 age=round(max(0.,now-htime),1)
 if htime>now+60:raise RuntimeError("S3 device clock unreliable")
 power=adb("shell","dumpsys","power")
 camera=adb("shell","dumpsys","media.camera")
 batt=adb("shell","dumpsys","battery")
 clients=camera.split("Prior client events",1)[0]
 owned="Client Package Name: nl.kalenel.s3motion" in clients and "Camera ID: 0" in clients
 wake=re.search(r"mWakefulness=([A-Za-z]+)",power)
 btemp=number(batt,"temperature")
 blevel=number(batt,"level")
 plugged=("AC powered: true" in batt or "USB powered: true" in batt)
 warnings=[]
 if age>35:warnings.append("camera_heartbeat_stale")
 if not owned:warnings.append("rear_camera_not_active")
 if btemp is not None and btemp>=420:warnings.append("battery_temperature_high")
 if blevel is not None and blevel<20:warnings.append("battery_very_low")
 if not plugged:warnings.append("charger_unplugged")
 def asint(x):
  try:return int(x)
  except (ValueError,TypeError):return None
 event_last=None
 if cams:
  mt=re.search(r"^\s*([0-9]{10}\.[0-9]+)\s+",cams[-1])
  if mt and float(mt.group(1))<=now+60:
   event_last=dt.datetime.fromtimestamp(float(mt.group(1)),dt.timezone.utc).isoformat()
 return {
  "sensor":"Galaxy S3 bedroom on-phone rear-camera motion",
  "checked_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
  "healthy":not warnings,
  "warnings":warnings,
  "camera_active":owned,
  "motion_analysis_active":age<=35 and owned,
  "camera_heartbeat_age_seconds":age,
  "camera_frames_since_app_start":asint(tag("frames")),
  "camera_session_id":tag("session"),
  "ambient_lux":asint(tag("lux")),
  "dark":tag("dark")=="1" if tag("dark") in ("0","1") else None,
  "camera_image_valid":tag("valid")=="1" if tag("valid") in ("0","1") else None,
  "camera_contrast":asint(tag("contrast")),
  "camera_night_profile":tag("profile"),
  "last_motion_event_utc_in_log":event_last,
  "battery_percent":blevel,
  "battery_temperature_c":round(btemp/10,1) if btemp is not None else None,
  "plugged_in":plugged,
  "battery_health_android_code":number(batt,"health"),
  "screen_state":wake.group(1) if wake else "unknown",
  "source":"on_phone_motion_v8_diagnostics",
  "images_or_audio_copied":False,
 }
def save(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 staging=path.with_name(path.name+".tmp")
 staging.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
 staging.chmod(0o644)
 os.replace(staging,path)
def main():
 try: data=parse()
 except Exception as e:
  data={
   "sensor":"Galaxy S3 bedroom on-phone rear-camera motion",
   "checked_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
   "healthy":False,"motion_analysis_active":False,"camera_active":None,
   "warnings":["s3_health_query_failed"],
   "query_error_type":type(e).__name__,
   "images_or_audio_copied":False
  }
 for path in (USERSTATE,OUT):
  save(path,data)
 print("S3_MOTION_HEALTH",json.dumps({
  "healthy":data["healthy"],
  "warnings":data["warnings"],
  "frames":data.get("camera_frames_since_app_start"),
  "lux":data.get("ambient_lux"),
  "battery":data.get("battery_percent"),
  "temperature_c":data.get("battery_temperature_c"),
  "display":data.get("screen_state"),
  "camera":data.get("camera_active"),
  "last_heartbeat_age_s":data.get("camera_heartbeat_age_seconds"),
  "ha_path":str(OUT),
 },sort_keys=True))
if __name__=="__main__":main()
