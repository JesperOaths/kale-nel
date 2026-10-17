#!/usr/bin/env python3
"""C720P-local once-only guarded S9+ V5 deployment, not a ChatGPT task.

Staging recompiles the exact pinned signed-app baseline without installing it.
A user-systemd timer checks a thermal/motion window before the installer may
interrupt Camera2. Every installer error latches off further attempts.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub")
CONF=ROOT/"etc/s9-face-v5-cool-window-v1.json"
STATE=ROOT/"state/s9-face-v5-cool-window-v1.json"
LOCK=ROOT/"state/s9-face-v5-cool-window-v1.lock"
API="http://127.0.0.1:18808/status"
VERSION="s9_onphone_36_samples_overlapping_tiles_v5"
SOURCE="ops/c720p/s9-native-security/"
MAX_RESTART_TEMP_C=34.5
MIN_SD_FREE=20*1024**3
INSTALL_TIMEOUT_S=940
BUILD_TIMEOUT_S=820

def report(event,**fields):
 print("S9_V5_COOL_WINDOW "+json.dumps(dict(event=event,**fields),sort_keys=True),flush=True)

def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as file:
  for data in iter(lambda:file.read(1024*1024),b""): h.update(data)
 return h.hexdigest()

def utc():
 return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

def config():
 d=json.loads(CONF.read_text())
 if not isinstance(d,dict) or not re.fullmatch(r"[0-9a-f]{40}",d.get("ref","")):
  raise ValueError("pinned_source_ref_invalid")
 for key in ("build_sha256","install_sha256"):
  if not re.fullmatch(r"[0-9a-f]{64}",d.get(key,"")):
   raise ValueError("pinned_source_digest_invalid")
 return d

def state_read(ref):
 if not STATE.exists(): return {"ref":ref,"status":"waiting"}
 obj=json.loads(STATE.read_text())
 if obj.get("ref")!=ref: return {"ref":ref,"status":"waiting"}
 return obj

def state_write(obj):
 STATE.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 data=json.dumps(obj,sort_keys=True)+"\n"
 with tempfile.NamedTemporaryFile(mode="w",dir=str(STATE.parent),prefix=".s9v5-",
                                  delete=False) as tmp:
  tmp.write(data);tmp.flush();os.fsync(tmp.fileno())
  tmpname=tmp.name
 os.chmod(tmpname,0o600)
 os.replace(tmpname,STATE)

def camera_status():
 with urllib.request.urlopen(API,timeout=12) as response:
  if response.status!=200: raise RuntimeError("phone_status_http_error")
  raw=response.read(150001)
 if len(raw)>150000: raise RuntimeError("phone_status_unbounded")
 return json.loads(raw)

def healthy(s):
 return (s.get("ok") is True and s.get("mode")=="watching" and
   s.get("native_4k_enabled") is True and s.get("continuous_4k_ready") is True and
   s.get("garden_person_gate_backend")=="gpu" and
   s.get("continuous_4k_buffered_ms",0)>=4400 and
   s.get("continuous_4k_dropped_output_frames",1)==0 and
   not s.get("continuous_4k_error") and
   s.get("sd_free_bytes",0)>=MIN_SD_FREE and
   s.get("last_frame_age_ms",99999)<2600)

def stage_eligible(s):
 """Reading the signed APK needs an alive camera service, not a live 4K codec.

 Thermal fallback can last until natural cooldown; preparing a candidate on
 C720P during fallback avoids an otherwise lengthy build in the cool window.
 No service stop, APK install, original MP4 read or face inference occurs.
 """
 return (s.get("ok") is True and s.get("mode")=="watching" and
   s.get("native_4k_enabled") is True and
   s.get("garden_person_gate_backend")=="gpu" and
   s.get("sd_free_bytes",0)>=MIN_SD_FREE and
   s.get("last_frame_age_ms",99999)<2600)

def idle(s):
 if s.get("face_backfill_queued") is True or s.get("movement_4k_backfill_queued") is True:
  return False
 if s.get("garden_person_gate_busy") is True: return False
 if s.get("mode")!="watching": return False
 age=s.get("person_last_accepted_motion_age_ms")
 if isinstance(age,(int,float)) and 0<=age<90000: return False
 return True

def stage_dir(ref):
 return Path("/dev/shm/s9-face-recall-v27")/ref[:12]

def prepared(d):
 stage=stage_dir(d["ref"])
 release=stage/"release.json"
 baseline=stage/"installed-before-v27.apk"
 if not release.is_file() or not baseline.is_file():return False
 meta=json.loads(release.read_text())
 apk=stage/"s9-face-recall-v27.apk"
 return (meta.get("source_sha")==d["ref"] and
         meta.get("signed") is True and
         meta.get("installed") is False and
         apk.is_file() and meta.get("apk")==str(apk) and
         sha(apk)==meta.get("sha256") and
         sha(baseline)==meta.get("baseline_apk_sha256"))

def fetch_verified(d,kind):
 name={"build":"build-s9-face-recall-v27.py",
       "install":"deploy-s9-face-recall-v27.py"}[kind]
 url=("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+
       d["ref"]+"/"+SOURCE+name)
 path=stage_dir(d["ref"])/name
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with urllib.request.urlopen(url,timeout=45) as response:
  raw=response.read(140001)
 if len(raw)>140000 or len(raw)<1000 or hashlib.sha256(raw).hexdigest()!=d[kind+"_sha256"]:
  raise RuntimeError("immutable_"+kind+"_checksum_mismatch")
 with tempfile.NamedTemporaryFile(dir=str(path.parent),prefix=".s9v5-src-",
                                  delete=False) as temp:
  temp.write(raw);temp.flush();os.fsync(temp.fileno())
  filename=temp.name
 os.chmod(filename,0o600)
 os.replace(filename,path)
 return path

def run_release_script(d,kind,timeout):
 script=fetch_verified(d,kind)
 env=dict(os.environ,S9_FACE_RECALL_V27_REF=d["ref"])
 result=subprocess.run(["/usr/bin/python3",str(script)],cwd=str(ROOT),env=env,
                       capture_output=True,text=True,timeout=timeout)
 # Report bounded receipts only; never relay face images or private media.
 output=(result.stdout or "")[-4500:]
 if result.returncode!=0:
  raise RuntimeError(kind+"_job_failed_exit_"+str(result.returncode)+
                     " "+(result.stderr or "")[-420:])
 return output

def tick(stage_only=False):
 d=config()
 ROOT.joinpath("state").mkdir(mode=0o700,parents=True,exist_ok=True)
 with LOCK.open("a+") as handle:
  fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  st=state_read(d["ref"])
  if st.get("status") in ("complete","needs_manual_recovery","installing"):
   report("terminal_state",state=st.get("status"),ref=d["ref"][:12])
   return
  try:
   phone=camera_status()
  except Exception as error:
   report("deferred_status_unavailable",error=type(error).__name__)
   return
  if healthy(phone) and phone.get("face_deep_rescue_version")==VERSION:
   st.update(status="complete",finished_at=utc(),phone_review_version=VERSION)
   state_write(st)
   report("already_v5_running",camera_4k_ready=True)
   return
  if not healthy(phone) and not (stage_only and stage_eligible(phone)):
   report("deferred_camera_not_ready",mode=phone.get("mode"),
          continuous_4k_ready=phone.get("continuous_4k_ready"),
          temperature_c=phone.get("temperature_c"),
          4k_last_result=phone.get("continuous_4k_last_result"),
          4k_cooldown_retry_ms=phone.get("continuous_4k_retry_after_ms"))
   return
  if not idle(phone):
   report("deferred_motion_or_background_work")
   return
  try:
   ready=prepared(d)
  except Exception as error:
   st.update(status="needs_manual_recovery",failure_at=utc(),
             reason="staged_release_integrity_"+type(error).__name__)
   state_write(st)
   report("staged_release_integrity_failure")
   return
  if not ready:
   # Building is non-disruptive: no APK installation, Camera2 restart, or
   # original-video write. Doing it ahead of the cool window avoids a long
   # javac/d8 delay between the final temperature check and installation.
   try:
    evidence=run_release_script(d,"build",BUILD_TIMEOUT_S)
    if "S9_FACE_RECALL_V27_SIGNED_STAGED" not in evidence or not prepared(d):
     raise RuntimeError("signed_stage_not_verifiable")
    report("signed_release_prepared",original_camera_unchanged=True)
   except Exception as error:
    st.update(status="needs_manual_recovery",failure_at=utc(),
              reason="build_"+type(error).__name__,detail=str(error)[-250:])
    state_write(st)
    report("build_failed_review_required",error=type(error).__name__)
    return
  if stage_only:
   report("stage_only_complete",camera_unchanged=True,
          4k_was_ready=phone.get("continuous_4k_ready"),
          temperature_c=phone.get("temperature_c"))
   return
  try:
   latest=camera_status()
  except Exception:
   report("deferred_post_build_status_unavailable")
   return
  if not healthy(latest) or not idle(latest):
   report("deferred_no_longer_idle")
   return
  temperature=latest.get("temperature_c")
  if not isinstance(temperature,(float,int)) or temperature>MAX_RESTART_TEMP_C:
   report("deferred_hot",temperature_c=temperature,
          required_max_c=MAX_RESTART_TEMP_C)
   return
  # Never attempt an APK restart twice after a genuine failure, even when a
  # GitHub workflow is rerun or the C720P is rebooted.
  st.update(status="installing",attempted_at=utc())
  state_write(st)
  try:
   receipt=run_release_script(d,"install",INSTALL_TIMEOUT_S)
   if "S9_FACE_RECALL_V27_DEVICE_VERIFIED" in receipt:
    phone=camera_status()
    if not healthy(phone) or phone.get("face_deep_rescue_version")!=VERSION:
     raise RuntimeError("post_install_current_version_not_live")
    st.update(status="complete",finished_at=utc(),phone_review_version=VERSION)
    state_write(st)
    report("v5_installed_verified",camera_4k_ready=True)
   elif ("S9_V27_FACE_RESCUE_DEFERRED" in receipt and
         "S9_FACE_RECALL_V27_DEVICE_VERIFIED" not in receipt):
    st.update(status="waiting",last_deferred_at=utc())
    state_write(st)
    report("installer_deferred_without_restart")
   else:
    raise RuntimeError("install_exit_without_device_verification")
  except Exception as error:
   st.update(status="needs_manual_recovery",failure_at=utc(),
             reason=type(error).__name__,detail=str(error)[-260:])
   state_write(st)
   report("install_failed_no_automatic_retry",error=type(error).__name__)
   return

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--stage-only",action="store_true")
 args=parser.parse_args()
 try:tick(stage_only=args.stage_only)
 except BlockingIOError:report("another_worker_active")
 except Exception as error:
  report("worker_error",error=type(error).__name__,detail=str(error)[-180:])
  raise

if __name__=="__main__":main()
