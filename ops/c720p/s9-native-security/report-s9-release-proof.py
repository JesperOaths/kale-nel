#!/usr/bin/env python3
"""Read-only proof of the installed S9 camera APK. Does not change the phone."""
import json
import re
import subprocess
import urllib.request

PHONE="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
CANDIDATE="7e5f03a135d5f11adda64dd0c217580160e96398f289e57e70b9cc16fac36976"
PREVIOUS="5e6804385827aec2772f10cdc13bf47f4295c5ed3c277631d6d2b1781ac37c03"

def read_command(*args):
 result=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,text=True,timeout=35)
 if result.returncode:
  raise RuntimeError("device_read_failed")
 return result.stdout

def apk_sha():
 paths=[line.partition(":")[2].strip() for line in
        read_command("shell","pm","path",PACKAGE).splitlines()
        if line.startswith("package:") and line.endswith("/base.apk")]
 if len(paths)!=1 or not paths[0].startswith("/data/app/"):
  raise RuntimeError("installed_apk_path_unverified")
 raw=read_command("shell","sha256sum",paths[0]).split()
 if not raw or not re.fullmatch(r"[0-9a-f]{64}",raw[0]):
  raise RuntimeError("installed_apk_sha_unverified")
 return raw[0]

def status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=15) as response:
  if response.status!=200:raise RuntimeError("camera_status_error")
  raw=response.read(180001)
 if len(raw)>180000:raise RuntimeError("status_too_large")
 return json.loads(raw)

def summary(sha,phone):
 return {"installed_apk_sha256":sha,
  "matches_full_archive_v5_candidate":sha==CANDIDATE,
  "matches_previous_v2_diagnostic_candidate":sha==PREVIOUS,
  "camera_ok":phone.get("ok") is True,
  "watching":phone.get("mode")=="watching",
  "continuous_4k_ready":phone.get("continuous_4k_ready") is True,
  "face_review_version":phone.get("face_deep_rescue_version"),
  "face_scan_completed_since_camera_start":phone.get("face_deep_scanned"),
  "face_scan_errors_since_camera_start":phone.get("face_deep_errors"),
  "camera_temperature_c":phone.get("temperature_c"),
  "read_only":True}

if __name__=="__main__":
 print("S9_RELEASE_PROOF "+json.dumps(summary(apk_sha(),status()),sort_keys=True))
