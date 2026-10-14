#!/usr/bin/env python3
"""Release redundant RAM-only Drive preview cache after every JPEG is durable.

This removes ONLY byte-verified old derived JPEG cache files that now have
individually verified durable replacements; it never touches original
recordings, cloud media, the indexed catalog, or existing persistent JPEGs.
Hold c720p-drive-thumb-v1.lock while running.
"""
from __future__ import annotations
import argparse,datetime,json,os,pathlib,urllib.request,shutil,sys
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
RAM=pathlib.Path("/tmp/c720p-drive-archive-thumbs-new")
DISK=BASE/"drive-archive-thumbs/new"
def valid(path):
 if not path.is_file() or path.is_symlink():return False
 n=path.stat().st_size
 if not (2500<=n<=8000000):return False
 with path.open("rb") as f:
  if f.read(2)!=bytes.fromhex("ffd8"):return False
  f.seek(-2,os.SEEK_END);return f.read(2)==bytes.fromhex("ffd9")
def main(apply):
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/drive-saved",timeout=15) as response:
  d=json.load(response)
 if not d.get("ok"):raise RuntimeError("drive_catalog_unavailable")
 names={str(x.get("snapshot_name") or "") for x in d.get("events",[])}
 if len(names)<170 or "" in names:raise RuntimeError("catalog_not_complete")
 if any(not valid(DISK/name) for name in names):
  raise RuntimeError("one_or_more_persistent_previews_invalid")
 files=[p for p in RAM.iterdir() if p.is_file() and not p.is_symlink()] if RAM.is_dir() else []
 known=[p for p in files if p.name in names and p.suffix.lower()==".jpg"]
 for p in known:
  if not valid(p) or not valid(DISK/p.name):
   raise RuntimeError("unsafe_to_release_"+p.name)
 before=sum(p.stat().st_size for p in known)
 if apply:
  for p in known:
   if valid(p) and valid(DISK/p.name):p.unlink()
  if any(not valid(DISK/name) for name in names):raise RuntimeError("durable_cache_disrupted")
  for name in (sorted(names)[0],sorted(names)[len(names)//2],sorted(names)[-1]):
   with urllib.request.urlopen("http://127.0.0.1:8795/new/drive/saved/snap/"+name,timeout=12) as response:
    if response.status!=200 or response.read(2)!=bytes.fromhex("ffd8"):
     raise RuntimeError("post_release_http_failed_"+name)
 print(json.dumps({"ok":True,"applied":apply,"catalog_size":len(names),
   "confirmed_durable":len(names),"tmpfs_jpegs_released":len(known) if apply else 0,
   "tmpfs_bytes_reclaimed":before if apply else 0,
   "root_free_bytes":shutil.disk_usage("/").free,
   "original_drive_media_modified":False,
   "persistent_jpegs_modified":False},sort_keys=True))
 return 0
if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true")
 sys.exit(main(parser.parse_args().apply))
