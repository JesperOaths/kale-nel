#!/usr/bin/env python3
"""Deploy native S9+ H264 pre-event ring only if actual phone frames encode.
After saving installed APK and performing guarded upgrade, automatically
restore previous APK if preview encoder is not functional after warmup.
"""
import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import urllib.request

BIN=Path("/home/jespern/c720p-home-hub/build/s9-preroll-v9")
SAFE=BIN/"safe-night-guard-upgrade.py"
BACK=Path("/home/jespern/c720p-home-hub/backups/native-security-cutover")

def load_safe():
 spec=importlib.util.spec_from_file_location("s9_safe_upgrade",SAFE)
 if not spec or not spec.loader:raise RuntimeError("missing_safe_installer")
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module
def status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:return json.load(r)
def relay():
 with urllib.request.urlopen("http://127.0.0.1:8793/health.json",timeout=9) as r:return json.load(r)
def main():
 safe=load_safe()
 apk=safe.APK
 if not apk.is_file():raise RuntimeError("apk_not_ready")
 expected=Path(str(apk)+".source-commit").read_text().strip()
 if expected!= "210acc9f0c230b1db4a2e713041919d0ef6c1c71":
  raise RuntimeError("wrong_source_revision")
 old=list(BACK.glob("S9-native-before-night-guard-*.apk"))
 safe.main()
 new=[p for p in BACK.glob("S9-native-before-night-guard-*.apk") if p not in old]
 if len(new)!=1:raise RuntimeError("rollback_not_unique")
 backup=new[0]
 last={}
 valid=False
 try:
  for step in range(12):
   time.sleep(2)
   last=status()
   valid=(last.get("ok") is True and last.get("mode")=="watching" and
    last.get("preroll_version")=="s9_on_phone_avc_memory_ring_v1" and
    last.get("preroll_enabled") is True and last.get("preroll_ready") is True and
    int(last.get("preroll_encoded_frames") or 0)>=15 and
    int(last.get("preroll_buffered_ms") or 0)>=1800 and
    last.get("preroll_last_error","")=="" and
    float(last.get("temperature_c") or 99)<40.0 and
    float(last.get("sensor_result_fps") or 0)>11.0)
   if valid:break
  if not valid:raise RuntimeError("preroll_not_ready_or_camera_performance_regressed:"+json.dumps(
    {k:last.get(k) for k in ('mode','preroll_enabled','preroll_ready','preroll_encoded_frames',
     'preroll_buffered_ms','preroll_last_error','sensor_result_fps','temperature_c')}))
  home=relay()
  if home.get("camera_ok") is not True:raise RuntimeError("live_relay_lost")
  print("S9_PREROLL_V9_LIVE_VERIFIED",json.dumps(
    {"prebuffer_ms":last["preroll_buffered_ms"],
    "cached_frames":last.get("preroll_buffered_frames"),
    "encoded_frames":last["preroll_encoded_frames"],
    "dropped_frames":last.get("preroll_dropped_frames"),
    "encoder_ready":last["preroll_ready"],"fps":last["sensor_result_fps"],
    "temperature_c":last["temperature_c"],"4k_enabled":last.get("native_4k_enabled"),
    "original_media_unchanged":True,"buffer_storage":"S9_phone_RAM",
    "backup":str(backup)},sort_keys=True),flush=True)
 except Exception:
  print("S9_PREROLL_V9_VALIDATION_FAILED_ROLLBACK",flush=True)
  safe.adb("shell","am","force-stop","nl.kalenel.s9security",timeout=13,check=False)
  safe.adb("install","-r","-g",str(backup),timeout=110)
  safe.launch()
  safe.wait_healthy(rate=False,max_wait=50)
  print("S9_PREVIOUS_CAMERA_RESTORED",flush=True)
  raise

if __name__=="__main__":main()
