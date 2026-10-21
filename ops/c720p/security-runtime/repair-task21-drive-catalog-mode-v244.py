#!/usr/bin/env python3
"""Tighten ONLY trusted Drive archive INDEX metadata group-write bit.

C720P manual and SD review store, capture, media and Drive bytes unchanged.
Requires same-user-owned safe immutable path, secure parent directory and the
existing Drive catalog writer's cooperative flock. No permission broadening.
"""
import argparse,fcntl,hashlib,json,os,stat
from pathlib import Path
ROOT=Path("/home/jespern/c720p-home-hub/state")
CAT=ROOT/"drive-security-archive.json"
LOCK=ROOT/"drive-security-archive.lock"
MARK="TASK21_DRIVE_CATALOG_MODE_V244_VERIFIED "

def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(131072),b""):h.update(b)
 return h.digest()

def safe(p,mode_file=True):
 if p.is_symlink() or not p.is_file():
  raise RuntimeError("archive_path_untrusted")
 st=p.stat()
 if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or
     st.st_uid!=os.geteuid() or st.st_mode&stat.S_IWOTH):
  raise RuntimeError("archive_untrusted_owner_or_hardlink")
 if mode_file and not 3<st.st_size<6000000:
  raise RuntimeError("archive_size_untrusted")
 parent=p.parent.stat()
 if (parent.st_uid!=os.geteuid() or not stat.S_ISDIR(parent.st_mode)
     or parent.st_mode&0o022 or p.parent.is_symlink()):
  raise RuntimeError("archive_parent_untrusted")
 return st

def repair():
 safe(LOCK,mode_file=False)
 with LOCK.open("a+") as lk:
  try:fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError("drive_archive_writer_busy")
  before=safe(CAT)
  previous_mode=stat.S_IMODE(before.st_mode)
  if not (previous_mode&stat.S_IRUSR):
   raise RuntimeError("archive_owner_unreadable")
  digest=sha(CAT)
  verified=safe(CAT)
  if verified.st_ino!=before.st_ino or verified.st_mtime_ns!=before.st_mtime_ns:
   raise RuntimeError("archive_changed_during_admission")
  desired=previous_mode & ~stat.S_IWGRP
  if desired!=previous_mode:
   # Use fd rather than chmod pathname after opening; guard against races.
   fd=os.open(CAT,os.O_RDONLY|os.O_NOFOLLOW)
   try:
    loaded=os.fstat(fd)
    if (loaded.st_ino!=before.st_ino or loaded.st_dev!=before.st_dev
       or loaded.st_size!=before.st_size or
       stat.S_IMODE(loaded.st_mode)!=previous_mode):
     raise RuntimeError("archive_replaced_before_chmod")
    os.fchmod(fd,desired);os.fsync(fd)
   finally:os.close(fd)
  after=safe(CAT)
  if (after.st_ino!=before.st_ino or after.st_dev!=before.st_dev
     or after.st_size!=before.st_size or after.st_mtime_ns!=before.st_mtime_ns
     or stat.S_IMODE(after.st_mode)!=desired or sha(CAT)!=digest):
   raise RuntimeError("archive_metadata_or_contents_changed_unexpectedly")
  print(MARK+json.dumps({
    "mode_group_write_removed":True,
    "owned_by_authenticated_agent":True,
    "safe_directory_parent":True,
    "no_original_media_bytes_read":True,
    "drive_catalog_bytes_unchanged":True,
    "manual_reviews_not_modified":True,
    "camera_apk_or_services_modified":False,
    "permissions_only_tightened":True,
    "archive_writer_lock_obtained":True},sort_keys=True),flush=True)

if __name__=="__main__":
 cli=argparse.ArgumentParser();cli.add_argument("--apply",action="store_true")
 args=cli.parse_args()
 if not args.apply:
  print("TASK21_DRIVE_CATALOG_MODE_V244_DRY_RUN "+json.dumps({
   "changes":False,"requires_apply":True},sort_keys=True))
 else:
  try:repair()
  except Exception:
   print("TASK21_DRIVE_CATALOG_MODE_V244_NOT_VERIFIED "+
    json.dumps({"failed":True,"review_content_not_intentionally_modified":True},
      sort_keys=True),flush=True)
   raise SystemExit(1)
