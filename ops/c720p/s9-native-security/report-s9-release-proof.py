#!/usr/bin/env python3
"""Read-only proof of the installed S9 camera APK. Does not change the phone."""
import json
import re
from pathlib import Path
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

def deployment_state():
 root=Path("/home/jespern/c720p-home-hub")
 config=root/"etc/s9-face-v5-cool-window-v1.json"
 worker=root/"state/s9-face-v5-cool-window-v1.json"
 result={"timer_enabled":False,"source_ref":None,
         "worker_state":"unavailable","signed_stage":"not_verified"}
 try:
  c=json.loads(config.read_text())
  ref=c.get("ref","")
  if not re.fullmatch(r"[0-9a-f]{40}",ref):return result
  result["source_ref"]=ref[:12]
  if worker.is_file():
   state=json.loads(worker.read_text())
   recorded_ref=state.get("ref","")
   result["worker_record_exists"]=True
   result["worker_ref_matches_pin"]=recorded_ref==ref
   if isinstance(recorded_ref,str) and re.fullmatch(r"[0-9a-f]{40}",recorded_ref):
    result["worker_state_source_ref"]=recorded_ref[:12]
   recorded_state=state.get("status","unknown")
   if recorded_state in ("waiting","complete","installing","needs_manual_recovery"):
    result["worker_state"]=recorded_state
  else:
   result["worker_record_exists"]=False
  release=Path("/dev/shm/s9-face-recall-v27")/ref[:12]/"release.json"
  result["pinned_stage_manifest_present"]=release.is_file()
  stage_root=release.parent.parent
  if stage_root.is_dir():
   result["other_staged_revisions"]=sorted(
    item.name for item in stage_root.iterdir()
    if item.is_dir() and re.fullmatch(r"[0-9a-f]{12}",item.name))[:8]
  if release.is_file():
   data=json.loads(release.read_text())
   if data.get("source_sha")==ref and re.fullmatch(r"[0-9a-f]{64}",str(data.get("sha256",""))):
    result["signed_stage"]=data["sha256"]
 except (OSError,ValueError,TypeError):
  pass
 proc=subprocess.run(["systemctl","--user","is-active","c720p-s9-face-v5-cool-window.timer"],
     capture_output=True,text=True,timeout=12)
 result["timer_enabled"]=proc.returncode==0 and proc.stdout.strip()=="active"
 try:
  log=subprocess.run(["journalctl","--user","-u","c720p-s9-face-v5-cool-window.service",
       "-n","30","--no-pager","-o","cat"],capture_output=True,text=True,timeout=15)
  for line in reversed(log.stdout.splitlines()):
   if "S9_V5_COOL_WINDOW " not in line:continue
   payload=json.loads(line.split("S9_V5_COOL_WINDOW ",1)[1])
   event=payload.get("event")
   if isinstance(event,str) and re.fullmatch(r"[a-z_]{2,65}",event):
    result["last_worker_event"]=event
    event_ref=payload.get("ref")
    if isinstance(event_ref,str) and re.fullmatch(r"[0-9a-f]{12}",event_ref):
     result["last_event_source_ref"]=event_ref
    break
 except (OSError,ValueError,TypeError,subprocess.TimeoutExpired):
  pass
 return result

def summary(sha,phone):
 deployment=deployment_state()
 staged=deployment.get("signed_stage")
 has_stage=isinstance(staged,str) and bool(re.fullmatch(r"[0-9a-f]{64}",staged))
 return {"installed_apk_sha256":sha,
  # A rebuilt signed release has a different checksum despite the same V5
  # camera revision. Compare the exact CURRENT pinned release, never only the
  # historical #676 candidate digest or an advertised version string.
  "matches_current_pinned_signed_release":sha==staged if has_stage else False,
  "current_pinned_signed_release_verified":has_stage,
  "matches_full_archive_v5_candidate":sha==CANDIDATE,
  "matches_previous_v2_diagnostic_candidate":sha==PREVIOUS,
  "camera_ok":phone.get("ok") is True,
  "watching":phone.get("mode")=="watching",
  "continuous_4k_ready":phone.get("continuous_4k_ready") is True,
  "face_review_version":phone.get("face_deep_rescue_version"),
  "face_scan_completed_since_camera_start":phone.get("face_deep_scanned"),
  "face_scan_errors_since_camera_start":phone.get("face_deep_errors"),
  "camera_temperature_c":phone.get("temperature_c"),
  "read_only":True,"deployment":deployment}

if __name__=="__main__":
 print("S9_RELEASE_PROOF "+json.dumps(summary(apk_sha(),status()),sort_keys=True))
