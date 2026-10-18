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

def state_summary(pinned_ref,state):
 """A completed PRIOR release is not a completion receipt for this APK."""
 result={"worker_record_exists":True,"worker_ref_matches_pin":False,
         "worker_state":"unavailable"}
 if not isinstance(state,dict):return result
 recorded=state.get("ref")
 status=state.get("status")
 if isinstance(recorded,str) and re.fullmatch(r"[0-9a-f]{40}",recorded):
  result["worker_state_source_ref"]=recorded[:12]
 result["worker_ref_matches_pin"]=recorded==pinned_ref
 allowed=("waiting","complete","installing","needs_manual_recovery")
 if status in allowed:
  if result["worker_ref_matches_pin"]:
   result["worker_state"]=status
  else:
   result["worker_state"]="stale_other_revision"
   result["previous_worker_state"]=status
 return result

def timer_service_readback():
 """Inspect unit scheduling and last exit without starting or modifying either unit.

 Only a fixed allowlist of systemd properties is returned. Historical
 journal events may be absent even when a timer is active; timestamps and
 service exit status distinguish an idle timer from a failing service.
 """
 props={
  "timer":("ActiveState","SubState","LastTriggerUSec","NextElapseUSecRealtime",
     "NextElapseUSecMonotonic","TimersCalendar","TimersMonotonic",
     "FragmentPath","NeedDaemonReload","LoadState","DropInPaths"),
  "service":("ActiveState","SubState","Result","ExecMainStatus",
             "ExecMainStartTimestamp","ExecMainExitTimestamp")
 }
 result={}
 for unit,fields in props.items():
  name="c720p-s9-face-v5-cool-window."+unit
  try:
   proc=subprocess.run(
    ["systemctl","--user","show",name,"--no-pager",
     "--property="+",".join(fields)],
    capture_output=True,text=True,timeout=12)
   if proc.returncode:continue
   for line in proc.stdout.splitlines():
    key,sep,value=line.partition("=")
    if (sep and key in fields and len(value)<=240 and
        all(ch.isprintable() for ch in value)):
     if key=="DropInPaths":
      result["timer_has_unit_dropins"]=bool(value.strip())
     else:
      result[unit+"_"+key]=value
  except (OSError,subprocess.TimeoutExpired):
   continue
 # Fixed, non-sensitive scheduling fields from the intended user unit.
 unit=Path("/home/jespern/.config/systemd/user/c720p-s9-face-v5-cool-window.timer")
 try:
  if unit.is_file() and not unit.is_symlink() and unit.stat().st_size<=6000:
   data=unit.read_text()
   allowed={"OnCalendar","OnActiveSec","OnUnitActiveSec",
            "OnBootSec","OnUnitInactiveSec","OnStartupSec"}
   declared=[]
   for line in data.splitlines():
    key,sep,value=line.partition("=")
    if sep and key in allowed and re.fullmatch(r"[A-Za-z0-9*:./-]{1,36}",value):
     declared.append(key+"="+value)
   result["timer_file_declared_triggers"]=declared[:8]
  result["timer_fragment_is_user_file"]=(
      result.get("timer_FragmentPath")==str(unit))
 except (OSError,ValueError):
  pass
 return result

def effective_timer_rules():
 """Parse only timer directives from systemd's loaded unit/drop-in view."""
 unit="c720p-s9-face-v5-cool-window.timer"
 result={"timer_effective_rule_available":False}
 try:
  proc=subprocess.run(["systemctl","--user","cat",unit,"--no-pager"],
                      capture_output=True,text=True,timeout=12)
  if proc.returncode or len(proc.stdout)>12000:return result
  allowed={"OnBootSec","OnStartupSec","OnUnitInactiveSec",
           "OnUnitActiveSec","OnActiveSec","OnCalendar"}
  selected=[]
  for line in proc.stdout.splitlines():
   key,sep,value=line.strip().partition("=")
   if sep and key in allowed and len(value)<=48:
    selected.append(key+"="+value)
  result["timer_effective_rule_available"]=True
  result["timer_effective_rule_declarations"]=selected[:15]
  result["timer_effective_rule_reset_present"]=any(
      entry.endswith("=") for entry in selected)
 except (OSError,subprocess.TimeoutExpired):
  pass
 return result

def timer_health_flags(result):
 def finite_deadline(value):
  return bool(value) and value not in ("infinity","n/a","0","-")
 next_due=(finite_deadline(result.get("timer_NextElapseUSecRealtime")) or
           finite_deadline(result.get("timer_NextElapseUSecMonotonic")))
 active_rules=result.get("timer_effective_rule_declarations") or []
 active_new_rules=any(row.startswith(("OnActiveSec=","OnUnitActiveSec=","OnCalendar="))
                      and not row.endswith("=") for row in active_rules)
 running=(result.get("timer_SubState")=="running" and
          result.get("service_ActiveState") in ("active","activating") and
          active_new_rules)
 healthy=(active_new_rules and (
      (result.get("timer_SubState")=="waiting" and next_due) or running))
 return {"timer_finite_future_deadline":next_due,
         "timer_guarded_worker_running":bool(running),
         "timer_healthy_recurrence":bool(healthy)}

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
   result.update(state_summary(ref,state))
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
 result.update(timer_service_readback())
 result.update(effective_timer_rules())
 result.update(timer_health_flags(result))
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

def restart_guard_observations(phone):
 # Diagnostic reflection of existing preflight conditions. This never
 # bypasses the installer's independent fresh camera-status checks.
 blocked=[]
 if phone.get("ok") is not True or phone.get("mode")!="watching":
  blocked.append("camera_not_watching")
 if phone.get("native_4k_enabled") is not True or phone.get("continuous_4k_ready") is not True:
  blocked.append("4k_not_healthy")
 if phone.get("garden_person_gate_backend")!="gpu":
  blocked.append("gpu_person_gate_not_ready")
 if phone.get("continuous_4k_error") not in (None,""):
  blocked.append("4k_encoder_error")
 if phone.get("continuous_4k_dropped_output_frames")!=0:
  blocked.append("4k_dropped_frames")
 for key,label in (
    ("face_backfill_queued","face_review_active"),
    ("movement_4k_backfill_queued","movement_review_active"),
    ("historical_import_queued","historical_import_active"),
    ("appearance_backfill_queued","appearance_review_active"),
    ("garden_archive_triage_queued","garden_triage_active"),
    ("garden_person_gate_busy","person_gate_busy")):
  if phone.get(key) is True: blocked.append(label)
 temp=phone.get("temperature_c")
 if type(temp) not in (float,int) or not 0<=temp<=40.5:
  blocked.append("battery_above_restart_guard_or_unavailable")
 free=phone.get("sd_free_bytes")
 if type(free) is not int or free<20*1024**3:
  blocked.append("sd_reserve_unavailable")
 frame_age=phone.get("last_frame_age_ms")
 if type(frame_age) not in (int,float) or not 0<=frame_age<2600:
  blocked.append("fresh_camera_frame_unavailable")
 motion=phone.get("person_last_accepted_motion_age_ms")
 if type(motion) in (int,float) and 0<=motion<90000:
  blocked.append("person_motion_recent")
 return {"observed_blockers":blocked,
  "observed_restart_idle":len(blocked)==0,
  "diagnostic_only":True}

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
  "restart_preflight_observation":restart_guard_observations(phone),
  "read_only":True,"deployment":deployment}

if __name__=="__main__":
 print("S9_RELEASE_PROOF "+json.dumps(summary(apk_sha(),status()),sort_keys=True))
