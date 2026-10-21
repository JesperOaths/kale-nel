#!/usr/bin/env python3
"""Task 21 fixed-path *metadata-only* review input classifier.

Never reads file contents, clip paths/IDs or credentials. Does not change
user permissions or decision state. Names only logical roles, not host paths.
"""
import argparse
import json
import os
import stat
from pathlib import Path

ROOT=Path("/home/jespern/c720p-home-hub/state")
SOURCES={
 "manual_reviews":("s9-manual-recording-links-v1.json",600000,True),
 "manual_audit":("s9-manual-recording-links-v1.audit.jsonl",2500000,True),
 "sd_catalog":("s9-standalone-archive-catalog-v1.json",5000000,False),
 "drive_catalog":("drive-security-archive.json",6000000,False),
}
MARK="TASK21_INPUT_METADATA_V241 "

def classify(path,limit,private):
 out={"exists":False,"regular":False,"symlink":False,
      "single_link":False,"size_bounded":False,
      "permissions_admissible":False,"owner_readable":False,
      "file_owned_by_current_agent":False,
      "group_writable":False,"world_writable":False,
      "parent_owned_by_current_agent":False,
      "parent_not_group_world_writable":False,
      "identity_stable":False,"reason":"missing"}
 try:
  st=path.lstat()
 except FileNotFoundError:return out
 except OSError:
  out["reason"]="metadata_unavailable";return out
 out["exists"]=True
 out["file_owned_by_current_agent"]=st.st_uid==os.geteuid()
 out["group_writable"]=bool(st.st_mode&stat.S_IWGRP)
 out["world_writable"]=bool(st.st_mode&stat.S_IWOTH)
 try:
  parent=path.parent.stat()
  out["parent_owned_by_current_agent"]=parent.st_uid==os.geteuid()
  out["parent_not_group_world_writable"]=(parent.st_mode&0o022)==0
 except OSError:pass
 out["symlink"]=stat.S_ISLNK(st.st_mode)
 out["regular"]=stat.S_ISREG(st.st_mode)
 out["single_link"]=st.st_nlink==1
 out["size_bounded"]=3<=st.st_size<limit
 out["owner_readable"]=bool(st.st_mode&stat.S_IRUSR)
 out["permissions_admissible"]=(
   (st.st_mode & (0o077 if private else 0o022))==0)
 try:
  later=path.lstat()
  out["identity_stable"]=(
   (st.st_dev,st.st_ino,st.st_mtime_ns,st.st_size)==
   (later.st_dev,later.st_ino,later.st_mtime_ns,later.st_size))
 except OSError:pass
 if out["symlink"]:out["reason"]="symlink"
 elif not out["regular"]:out["reason"]="not_regular"
 elif not out["single_link"]:out["reason"]="hardlinked"
 elif not out["size_bounded"]:out["reason"]="size_outside_limit"
 elif not out["permissions_admissible"]:out["reason"]="mode_not_admitted"
 elif not out["owner_readable"]:out["reason"]="owner_not_readable"
 elif not out["identity_stable"]:out["reason"]="changed_during_inspection"
 else:out["reason"]="eligible_metadata"
 return out

def audit():
 return {"schema_version":"task21_fixed_metadata_v241",
  "sources":{role:classify(ROOT/name,limit,private)
    for role,(name,limit,private) in SOURCES.items()},
  "original_bytes_read":0,"review_file_contents_read":False,
  "manual_review_state_changed":False,"permissions_changed":False,
  "media_modified":False,"camera_apk_modified":False}
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if args.run:print(MARK+json.dumps(audit(),sort_keys=True))
 else:print(MARK+json.dumps({"read_only":True,"ran_physical_inspection":False},
   sort_keys=True))
