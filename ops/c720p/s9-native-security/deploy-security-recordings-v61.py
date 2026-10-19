#!/usr/bin/env python3
"""Guarded, read-only-inventory V61 player status deployment.

Only updates the existing Recordings/Evidence HTML and its cache-busted iframe
URLs in the active Security hub. No video bytes, capture, transcode, or person
decisions are modified. Requires the exact previously deployed V58 source.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
PAGE=ROOT/"security-review-v8.html"
HUB=ROOT/"security-hub-v30.js"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-recordings-segments-v61")
OLD="ccf4bb058d1d235ce81bad780ab7df4e7341c1d1"
NEW="62089aa1eee2937e16038e3fb9e9c4c513cbeb21"
FILE="ops/c720p/s9-native-security/security-review-v8.html"
TAG="security-original-segments-v61-20261019"
MATCH=re.compile(r"security-review-v8[.]html[?]mode=(today|evidence)(?:&v=[A-Za-z0-9._-]+)?")
def digest(data):return hashlib.sha256(data).hexdigest()
def get(url,limit):
 with urllib.request.urlopen(url,timeout=35) as r:
  result=r.read(limit+1)
 if not 60<len(result)<=limit:raise RuntimeError("unexpected_response")
 return result
def source(ref):
 return get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+ref+"/"+FILE,120000)
def archive():
 raw=get("http://127.0.0.1:8795/new/api/saved",4000000)
 parsed=json.loads(raw)
 if parsed.get("archive_mode")!="S9-microSD-only":raise RuntimeError("wrong_archive_mode")
 rows=parsed.get("events",[])
 names={x.get("clip_no") for x in rows if isinstance(x,dict)}
 if len(names)<100 or len(rows)!=len(names):raise RuntimeError("archive_incomplete")
 return names
def atom(path,data,previous):
 fd,tmp=tempfile.mkstemp(prefix=".security-original-segment-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(previous.st_mode))
  try:os.chown(tmp,previous.st_uid,previous.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def new_hub(raw):
 text=raw.decode("utf-8")
 matches=list(MATCH.finditer(text))
 if not 1<=len(matches)<=8:raise RuntimeError("unknown_recordings_route")
 next_text=MATCH.sub(lambda m:"security-review-v8.html?mode="+m.group(1)+"&v="+TAG,text)
 if next_text.count(TAG)<len(matches):raise RuntimeError("cache_tag_not_updated")
 return next_text.encode()
def main():
 args=argparse.ArgumentParser()
 args.add_argument("--apply",action="store_true")
 options=args.parse_args()
 if shutil.disk_usage(ROOT).free<24*1024*1024:raise RuntimeError("insufficient_free_hub_disk")
 before=archive()
 old=source(OLD);new=source(NEW)
 if old==new:raise RuntimeError("unchanged_original_status")
 for marker in (b"securityPlaybackSegment='preroll'",b"securityPlaybackSegment='original'",
                b"Original video playback: ",b"Pre-event buffer playback: "):
  if marker not in new:raise RuntimeError("missing_new_segment_contract")
 if b"Original video playback: " in old:raise RuntimeError("bad_old_contract")
 pages={}
 for path in (PAGE,HUB):
  if path.is_symlink() or not path.is_file():raise RuntimeError("missing_asset_"+path.name)
  pages[path]=(path.read_bytes(),path.stat())
 if pages[PAGE][0] not in (old,new):raise RuntimeError("live_review_html_differs_from_known_preimage")
 targets={PAGE:new,HUB:new_hub(pages[HUB][0])}
 if not options.apply:
  print("SECURITY_RECORDINGS_V61_DRY_RUN_PASS "+json.dumps({
   "originals":len(before),"new_sha256":digest(new),
   "routes":[PAGE.name,HUB.name],"current_new":pages[PAGE][0]==new,
   "no_media_writes":True},sort_keys=True),flush=True)
  return
 backup=BACKUP/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for path,(raw,_) in pages.items():
  dest=backup/path.name
  dest.write_bytes(raw);os.chmod(dest,0o600)
  if digest(dest.read_bytes())!=digest(raw):raise RuntimeError("backup_integrity")
 changed=[]
 try:
  for path,blob in targets.items():
   raw,st=pages[path]
   if raw!=path.read_bytes():raise RuntimeError("concurrent_hub_asset_change")
   if blob!=raw:atom(path,blob,st);changed.append(path)
  served={}
  for path,blob in targets.items():
   url="http://127.0.0.1:8123/local/frontyard-security-new/"+path.name+"?v="+TAG
   actual=get(url,200000)
   if digest(actual)!=digest(blob):raise RuntimeError("ha_http_asset_hash_mismatch_"+path.name)
   served[path.name]=digest(actual)[:16]
  after=archive()
  if not before.issubset(after):raise RuntimeError("original_index_regressed")
  print("SECURITY_RECORDINGS_V61_DEPLOY_VERIFIED "+json.dumps({
   "old_ref":OLD,"new_ref":NEW,"media_originals_before":len(before),
   "media_originals_after":len(after),"assets_served_sha16":served,
   "changed":[p.name for p in changed],"rollback":str(backup),
   "camera_touched":False,"reviews_touched":False,
   "browser_acceptance_pending":True},sort_keys=True),flush=True)
 except BaseException:
  for path in reversed(changed):
   try:atom(path,*pages[path])
   except Exception as error:print("SECURITY_RECORDINGS_V61_ROLLBACK_ERROR",path.name,str(error)[:100],flush=True)
  raise
if __name__=="__main__":main()
