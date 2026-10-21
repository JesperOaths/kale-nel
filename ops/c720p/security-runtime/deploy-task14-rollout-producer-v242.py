#!/usr/bin/env python3
"""Task14 deploy ONLY corrected Camera2 rollout producer Python, NEVER its APK.

Requires physical #12331 old/new exact hashes, immutable reviewed candidate,
terminal original result already verified installed=true and phone APK SHA,
healthy 4K before/after. Uses existing rollout lock, backs up original and
atomically installs new producer source; never executes its main(), service,
installation path, S9 ADB or any media/review operation.
"""
import argparse
import fcntl
import hashlib
import json
import os
import stat
import tempfile
import time
from pathlib import Path
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
TARGET=HOME/"bin/s9_7s_cool_rollout_v1.py"
TERMINAL=HOME/"state/s9-native-seven-second-rollout-v1.json"
LOCK=HOME/"state/.s9-native-seven-second-rollout.lock"
BACKUP=HOME/"backups/task14-rollout-python-only"
ORIGINAL_SHA="c785b78a30603d88a9e2dddb40843f85b191c88b6ea966b6b71906720eabcaf1"
APPROVED_SHA="fcf789bb5b5129c1fc125e653fa8735d9063ba635d20e564f6b06a285bfe517e"
CANDIDATE="37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"
MARK="S9_TASK14_ROLLOUT_SOURCE_ONLY_V242_INSTALLED "
SOURCE_VERSION="task14_rollout_python_only_v242"

def exact_file(p,bound,private=False):
 if p.is_symlink() or not p.is_file():raise RuntimeError("required_file_untrusted")
 st=p.stat()
 if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or
      not 10<st.st_size<bound or
      (private and st.st_mode&0o077)):
  raise RuntimeError("file_owner_mode_size_untrusted")
 a=p.read_bytes()
 if len(a)!=st.st_size or p.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("source_changed_during_read")
 return a

def sha(value):return hashlib.sha256(value).hexdigest()

def healthy():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as response:
  if response.status!=200:raise RuntimeError("camera_status_unavailable")
  data=json.loads(response.read(65537))
 if (data.get("ok") is not True or data.get("mode")!="watching"
   or data.get("native_4k_enabled") is not True
   or data.get("continuous_4k_ready") is not True
   or data.get("continuous_4k_dropped_output_frames")!=0
   or data.get("continuous_4k_error")
   or type(data.get("temperature_c")) not in (int,float)
   or not 0<data["temperature_c"]<=38.0):
  raise RuntimeError("camera_unhealthy_or_hot")
 return data

def terminal_read():
 doc=json.loads(exact_file(TERMINAL,150000,private=True))
 if (doc.get("state")!="done" or
   doc.get("installed") is not True or
   doc.get("candidate_sha256")!=CANDIDATE or
   doc.get("schema_version")!="s9_native_7s_cool_rollout_v1"):
  raise RuntimeError("original_terminal_result_not_approved")
 return doc

def validate_code(code):
 compile(code,TARGET.name,"exec",dont_inherit=True)
 context={"__name__":"_task14_read_only_source_check_"}
 exec(compile(code,TARGET.name,"exec"),context)
 helper=context.get("verified_success_fields")
 if not callable(helper):raise RuntimeError("new_success_helper_missing")
 fixture={"ok":True,"mode":"watching","native_4k_enabled":True,
  "continuous_4k_ready":True,"continuous_4k_trial_active":True,
  "continuous_4k_production_persisted":True,"temperature_c":30.0,
  "continuous_4k_buffered_ms":7100,
  "continuous_4k_dropped_output_frames":0,
  "garden_person_gate_backend":"gpu","garden_person_gate_ready":True,
  "last_frame_age_ms":200,"sd_free_bytes":30*1024**3}
 for already in (False,True):
  fields=helper(fixture,already_installed=already)
  if (fields.get("installed") is not True or
    fields.get("already_installed") is not already or
    fields.get("video_or_reviews_modified") is not False):
   raise RuntimeError("corrected_success_contract_invalid")
 return True

def install(approved_blob):
 if sha(approved_blob)!=APPROVED_SHA:
  raise RuntimeError("unapproved_producer_bytes")
 before=healthy()
 if LOCK.is_symlink() or not LOCK.parent.is_dir():
  raise RuntimeError("unsafe_rollout_lock")
 with LOCK.open("a+") as lk:
  try:fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:
   raise RuntimeError("rollout_lock_busy")
  recorded=terminal_read()
  old=exact_file(TARGET,150000)
  before_sha=sha(old)
  if before_sha not in (ORIGINAL_SHA,APPROVED_SHA):
   raise RuntimeError("unknown_concurrent_rollout_source")
  if before_sha==APPROVED_SHA:
   validate_code(old)
   changed=False
  else:
   validate_code(approved_blob)
   if BACKUP.is_symlink() or (BACKUP.exists() and not BACKUP.is_dir()):
    raise RuntimeError("unsafe_backup_root")
   BACKUP.mkdir(mode=0o700,parents=True,exist_ok=True)
   if BACKUP.is_symlink() or BACKUP.stat().st_mode&0o077:
    raise RuntimeError("untrusted_backup_permissions")
   name="before-"+before_sha+".py"
   backed=BACKUP/name
   if backed.exists():
    if sha(exact_file(backed,150000,private=True))!=before_sha:
     raise RuntimeError("backup_name_collision")
   else:
    fd=os.open(str(backed),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
     with os.fdopen(fd,"wb") as f:
      f.write(old);f.flush();os.fsync(f.fileno())
    except BaseException:
     raise
   if sha(exact_file(backed,150000,private=True))!=before_sha:
    raise RuntimeError("backup_readback_invalid")
   fd,temp=tempfile.mkstemp(dir=TARGET.parent,prefix=".s9-rollout-task14-",suffix=".py")
   tmp=Path(temp)
   try:
    with os.fdopen(fd,"wb") as f:
     os.fchmod(f.fileno(),stat.S_IMODE(TARGET.stat().st_mode))
     f.write(approved_blob);f.flush();os.fsync(f.fileno())
    if sha(exact_file(TARGET,150000))!=before_sha:
     raise RuntimeError("installed_producer_changed_during_stage")
    if sha(exact_file(tmp,150000))!=APPROVED_SHA:
     raise RuntimeError("staged_bytes_mismatch")
    os.replace(tmp,TARGET)
    dir_fd=os.open(str(TARGET.parent),os.O_RDONLY)
    try:os.fsync(dir_fd)
    finally:os.close(dir_fd)
    if sha(exact_file(TARGET,150000))!=APPROVED_SHA:
     raise RuntimeError("installed_producer_readback_invalid")
    changed=True
   except BaseException:
    # A newer concurrent writer is never overwritten by rollback.
    if sha(exact_file(TARGET,150000))==APPROVED_SHA and sha(old)==ORIGINAL_SHA:
     fd2,temp2=tempfile.mkstemp(dir=TARGET.parent,prefix=".task14-rollback-",suffix=".py")
     try:
      with os.fdopen(fd2,"wb") as f:
       f.write(old);f.flush();os.fsync(f.fileno())
      os.replace(temp2,TARGET)
     finally:
      if os.path.exists(temp2):os.unlink(temp2)
    raise
   finally:
    if tmp.exists():tmp.unlink()
  after=healthy()
  if terminal_read()!=recorded:
   raise RuntimeError("terminal_state_changed_unexpectedly")
  result={"schema_version":SOURCE_VERSION,
    "producer_sha256":sha(exact_file(TARGET,150000)),
    "source_only_changed":changed,
    "already_installed_source":not changed,
    "exact_success_branch_accepted_synthetic":True,
    "no_camera_reinstall_or_restart":True,
    "candidate_apk_not_modified":True,"terminal_provenance_not_modified":True,
    "videos_or_reviews_modified":False,
    "camera_ready_after":True,"camera_dropped_frames_after":0,
    "camera_temperature_c":after["temperature_c"]}
  print(MARK+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--apply",action="store_true")
 parser.add_argument("--source")
 args=parser.parse_args()
 if not args.apply:
  print("S9_TASK14_V242_DRY_RUN "+json.dumps({"no_reinstall":True,
     "requires_apply":True,"media_modified":False},sort_keys=True))
 else:
  if not args.source:raise SystemExit("S9_TASK14_V242_SOURCE_REQUIRED")
  try:install(exact_file(Path(args.source),150000))
  except Exception:
   print("S9_TASK14_V242_NOT_VERIFIED "+json.dumps({
    "safety_admission_failed":True,"no_camera_reinstall_or_restart":True,
    "terminal_state_not_repaired":True},sort_keys=True),flush=True)
   raise SystemExit(1)
