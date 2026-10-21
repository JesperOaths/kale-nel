#!/usr/bin/env python3
"""Lstat only for exact existing Drive service configuration. No content/media reads."""
import json,os,stat
from pathlib import Path
P=Path("/home/jespern/c720p-home-hub/config/drive-security-archive.json")
def run():
 try:
  f=P.lstat();d=P.parent.lstat()
 except OSError:
  return {"exists":False,"content_read":False,"changed":False}
 return {"exists":True,
  "regular":stat.S_ISREG(f.st_mode),"symlink":stat.S_ISLNK(f.st_mode),
  "single_link":f.st_nlink==1,
  "owner_is_agent":f.st_uid==os.geteuid(),
  "parent_owned_by_agent":d.st_uid==os.geteuid(),
  "parent_write_group_or_world":bool(d.st_mode&0o022),
  "mode_0600":stat.S_IMODE(f.st_mode)==0o600,
  "mode_0644":stat.S_IMODE(f.st_mode)==0o644,
  "mode_0664":stat.S_IMODE(f.st_mode)==0o664,
  "group_read":bool(f.st_mode&stat.S_IRGRP),
  "group_write":bool(f.st_mode&stat.S_IWGRP),
  "world_read":bool(f.st_mode&stat.S_IROTH),
  "world_write":bool(f.st_mode&stat.S_IWOTH),
  "size_bounded":10<f.st_size<=100000,
  "content_read":False,"changed":False}
if __name__=="__main__":
 print("TASK21_DRIVE_CONFIG_METADATA_V250 "+json.dumps(run(),sort_keys=True))
