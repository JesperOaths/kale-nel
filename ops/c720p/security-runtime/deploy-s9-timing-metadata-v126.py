#!/usr/bin/env python3
"""Exact live C720P private catalog-validator update with no archive mutation.

The installed phone_archive_catalog_v1.py checksum was confirmed by read-only
C720P job #12029. Only that prior file or the new exact target is accepted.
The index re-scan and saved proof run in their OWN ordinary systemd units.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import subprocess

HOME=Path("/home/jespern/c720p-home-hub")
MODULE=HOME/"bin/phone_archive_catalog_v1.py"
LOCK=HOME/"state/s9-standalone-catalog.lock"
BACKUP=HOME/"backups/s9-timing-whitelist-v126"
OLD_SHA="345b51532b06918329eaba5e12d4e9fa8366628161a8912bcd4f7291646e28f2"
STATUS="S9_TIMING_METADATA_V126_"
FIELDS=(
 "capture_segment_end_reason","capture_segment_configured_quiet_hold_ms",
 "capture_segment_start_elapsed_ms","capture_segment_stop_elapsed_ms",
 "capture_segment_last_accepted_motion_age_at_stop_ms",
)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def disk_reserve(path):
 fs=os.statvfs(str(path))
 return fs.f_bavail*fs.f_frsize>=800*1024**2
def safe_source(raw):
 if not 12000<len(raw)<60000:raise RuntimeError("invalid_target_module_size")
 text=raw.decode("utf-8")
 compile(text,str(MODULE),"exec")
 if "def safe_capture_segment(manifest):" not in text or any(k not in text for k in FIELDS):
  raise RuntimeError("target_missing_capture_provenance")
 if "appearance_vector" in text.split("def safe_capture_segment(manifest):")[1].split("def safe_metadata(")[0]:
  raise RuntimeError("unexpected_private_vector_reference")
def atomic(path,raw,mode):
 fd,tmp=tempfile.mkstemp(prefix=".timing-v126-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(mode.st_mode))
  try:os.chown(tmp,mode.st_uid,mode.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.lexists(tmp):os.unlink(tmp)
def run(candidate,expected,apply):
 if not re.fullmatch("[a-f0-9]{64}",expected):
  raise RuntimeError("invalid_pinned_candidate_sha")
 if MODULE.is_symlink() or not MODULE.is_file() or candidate.is_symlink():
  raise RuntimeError("unsafe_module_or_candidate")
 new=candidate.read_bytes()
 if digest(new)!=expected:raise RuntimeError("candidate_sha_mismatch")
 safe_source(new)
 if LOCK.is_symlink() or not LOCK.parent.is_dir():
  raise RuntimeError("unsafe_standalone_catalog_lock")
 fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,"a+") as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:
   print(STATUS+"DEFERRED "+json.dumps({"reason":"catalog_worker_busy","module_modified":False}),flush=True)
   return
  before=MODULE.read_bytes()
  current=digest(before)
  if current==expected:
   print(STATUS+"VERIFIED "+json.dumps({"already":True,
     "module_sha256":expected,"module_modified":False,
     "recordings_modified":False,"manual_reviews_modified":False,
     "camera_apk_modified":False}),flush=True)
   return
  if current!=OLD_SHA:
   print(STATUS+"DEFERRED "+json.dumps({
     "reason":"newer_live_module_no_overwrite","module_modified":False,
     "originals_modified":False}),flush=True)
   return
  if not disk_reserve(HOME):raise RuntimeError("backup_disk_reserve_low")
  if not apply:
   print(STATUS+"PREFLIGHT "+json.dumps({"live_prior_sha256":current,
     "requested_sha256":expected,"would_modify_module":True,
     "recordings_modified":False}),flush=True)
   return
  backup=BACKUP/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
  backup.mkdir(parents=True,mode=0o700,exist_ok=False)
  oldfile=backup/"phone_archive_catalog_before.py"
  with oldfile.open("xb") as out:
   out.write(before);out.flush();os.fsync(out.fileno())
  os.chmod(oldfile,0o600)
  oldmode=MODULE.stat()
  try:
   if digest(MODULE.read_bytes())!=current:raise RuntimeError("module_raced_before_replace")
   atomic(MODULE,new,oldmode)
   if digest(MODULE.read_bytes())!=expected:raise RuntimeError("module_postinstall_sha_mismatch")
   print(STATUS+"VERIFIED "+json.dumps({"already":False,
     "module_sha256":expected,"backup":str(backup),
     "module_modified":True,"recordings_modified":False,
     "manual_reviews_modified":False,"camera_apk_modified":False}),flush=True)
  except BaseException:
   atomic(MODULE,before,oldmode)
   if digest(MODULE.read_bytes())!=current:raise RuntimeError("module_rollback_failed")
   print(STATUS+"ROLLED_BACK",flush=True)
   raise
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--candidate",type=Path,required=True)
 parser.add_argument("--expected-sha256",required=True)
 parser.add_argument("--apply",action="store_true")
 a=parser.parse_args()
 run(a.candidate,a.expected_sha256,a.apply)
if __name__=="__main__":main()
