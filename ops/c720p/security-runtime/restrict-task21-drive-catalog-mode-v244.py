#!/usr/bin/env python3
"""Single known non-media catalog: restrict group-write only, never read bytes.

This is NOT manual review metadata, Drive footage, camera state, or digest
binding. Physical V243 found only archive catalog group-write bit violating
V241 admission. File and protected parent must be owned by the agent, stable,
single-link regular, no symlink or concurrent file writer. The only mutation
is fchmod to remove the catalog file's GROUP WRITE bit after preflight. All
original 0600 manual reviews, full videos, thumb and reviews untouched.
"""
import argparse
import fcntl
import json
import os
import stat
from pathlib import Path

FILE=Path("/home/jespern/c720p-home-hub/state/drive-security-archive.json")
LOCK=Path("/home/jespern/c720p-home-hub/state/.task21-drive-catalog-mode-v244.lock")
MARK="TASK21_DRIVE_CATALOG_MODE_V244 "

def require(cond,why):
 if not cond:raise RuntimeError(why)

def snapshot(fd,root):
 st=os.fstat(fd)
 parent=root.parent.stat()
 require(stat.S_ISREG(st.st_mode) and st.st_nlink==1
         and 3<=st.st_size<6000000,
         "catalog_not_proven_regular_and_bounded")
 require(st.st_uid==os.geteuid() and parent.st_uid==os.geteuid()
         and (parent.st_mode&0o022)==0,
         "catalog_ownership_or_parent_unsafe")
 require((st.st_mode&0o002)==0 and bool(st.st_mode&stat.S_IRUSR)
         and (st.st_mode&0o700)==0o600,
         "catalog_owner_or_world_permission_drift")
 require((st.st_mode&0o177)==0o064,
         "catalog_unexpected_extra_permissions")
 require((st.st_mode&stat.S_IWGRP)!=0,
         "catalog_already_or_unexpectedly_fixed")
 return st

def apply():
 require(FILE.parent.is_dir() and not FILE.parent.is_symlink()
         and not FILE.is_symlink() and not LOCK.is_symlink(),
         "catalog_or_lock_symlink")
 lockfd=os.open(LOCK,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  lst=os.fstat(lockfd)
  require(stat.S_ISREG(lst.st_mode) and lst.st_nlink==1
     and lst.st_uid==os.geteuid() and (lst.st_mode&0o077)==0,
     "mode_lock_unsafe")
  fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  fd=os.open(FILE,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   before=snapshot(fd,FILE)
   # No TOCTOU race with a replacement or link swap.
   local=FILE.lstat()
   require((local.st_dev,local.st_ino,local.st_size,local.st_mtime_ns)==
        (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns),
        "catalog_changed_before_mode_fix")
   # chmod only the already opened same inode, stripping its group write bit.
   os.fchmod(fd,stat.S_IMODE(before.st_mode)&~stat.S_IWGRP)
   after=os.fstat(fd)
   require((after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)==
       (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)
       and stat.S_IMODE(after.st_mode)==
        (stat.S_IMODE(before.st_mode)&~stat.S_IWGRP),
       "catalog_mode_readback_failed")
   require((FILE.lstat().st_dev,FILE.lstat().st_ino)==
       (after.st_dev,after.st_ino),"catalog_replaced_after_mode_fix")
   os.fsync(fd)
  finally:os.close(fd)
 finally:os.close(lockfd)
 print(MARK+json.dumps({"drive_catalog_group_write_removed":True,
  "catalog_content_read":False,"catalog_content_modified":False,
  "manual_reviews_modified":False,"manual_audit_modified":False,
  "media_bytes_read":0,"video_or_people_modified":False,
  "camera_service_touched":False},sort_keys=True),flush=True)

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 if not args.apply:
  print(MARK+json.dumps({"dry_run":True,"catalog_bytes_read":0,
       "permissions_modified":False},sort_keys=True))
 else:
  try:apply()
  except Exception as error:
   permitted={"catalog_or_lock_symlink","mode_lock_unsafe",
     "catalog_not_proven_regular_and_bounded","catalog_ownership_or_parent_unsafe",
     "catalog_owner_or_world_permission_drift","catalog_unexpected_extra_permissions",
     "catalog_already_or_unexpectedly_fixed","catalog_changed_before_mode_fix",
     "catalog_mode_readback_failed","catalog_replaced_after_mode_fix"}
   why=str(error)
   if why not in permitted:why="failed_closed_other"
   print("TASK21_DRIVE_CATALOG_MODE_V244_NOT_VERIFIED "+
      json.dumps({"reason":why,"media_modified":False,
       "manual_reviews_modified":False},sort_keys=True),flush=True)
   raise SystemExit(1)
