#!/usr/bin/env python3
"""Guarded V62 UI-only fix, preserves the already deployed V60 People interface.

No identity guesses, review decisions, source recordings, camera sessions or
background workers are modified. Refuse an unexpected live source exactly.
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

BASE=Path("/opt/homeassistant/config/www")
ROOT=BASE/"frontyard-security-new"
ASSETS={
 "js":ROOT/"security-people-v45.js",
 "people":ROOT/"security-people-v50.html",
 "hub":ROOT/"security-hub-v30.js",
 "entry":ROOT/"security-hub-v30.html",
 "shell":BASE/"c720p-surveillance.html"}
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-people-v62")
BASE_SHA="e260d8f988a330d80d0aca6cf6530146d94f3e0d"
NEW_SHA="6214c08eab6f365d6114b0b7e124b07b3e0c4b74"
LIVE_V60_SHA256="74874ab811c6aeaa14d94028d5861f7d93b8ad86b7fe21327ac9cc57c50cf8ba"
FILE="ops/c720p/s9-native-security/security-people-v45.js"
OLD_TAG="security-people-v60-20261019"
NEW_TAG="security-people-v62-20261019"
OLD_RETURN=b"const item=state.playingItem;if(!item||!assignedFolder(item))return;"
NEW_RETURN=b"const item=state.playingItem;if(!item||!(assignedFolder(item)||item.approvedFolderContext))return;"
def sha(raw):return hashlib.sha256(raw).hexdigest()
def get(url,limit):
 with urllib.request.urlopen(url,timeout=35) as response:
  data=response.read(limit+1)
 if not 50<len(data)<=limit:raise RuntimeError("unexpected_remote_length")
 return data
def original_names():
 record=json.loads(get("http://127.0.0.1:8795/new/api/saved",4000000))
 if record.get("archive_mode")!="S9-microSD-only":raise RuntimeError("wrong_archive")
 events=record.get("events",[])
 names={x.get("clip_no") for x in events if isinstance(x,dict)}
 if len(names)<100 or len(names)!=len(events):raise RuntimeError("archive_incomplete")
 return names
def remote(commit):
 return get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+commit+"/"+FILE,150000)
def section(data,start,end):
 first=data.index(start)
 last=data.index(end,first)
 return data[first:last]
def patched(live,old_main,new_main):
 if sha(live)!=LIVE_V60_SHA256:
  raise RuntimeError("unexpected_live_v60_people_content")
 out=live
 for start,end in (
   (b"function startVideo(item){",b"// Step 3:"),
   (b"async function searchClothingMatches(",b"function renderClothing()"),
   (b"function renderClothing(){",b"function renderFolder()")):
  old=section(old_main,start,end)
  new=section(new_main,start,end)
  if out.count(old)!=1 or old==new:raise RuntimeError("unexpected_people_patch_anchor")
  out=out.replace(old,new,1)
 if out.count(OLD_RETURN)!=1 or NEW_RETURN not in new_main:
  raise RuntimeError("unexpected_original_return_guard")
 out=out.replace(OLD_RETURN,NEW_RETURN,1)
 for required in (b"approvedFolderContext",b"for(let pass=0;pass<3",
                  b"within 72 hours",b"/new/api/s9-manual-recording-links"):
  if required not in out:raise RuntimeError("expected_v62_control_absent")
 return out
def atom(path,payload,meta):
 fd,tmp=tempfile.mkstemp(prefix=".security-people-v62-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as stream:
   stream.write(payload);stream.flush();os.fsync(stream.fileno())
  os.chmod(tmp,stat.S_IMODE(meta.st_mode))
  try:os.chown(tmp,meta.st_uid,meta.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 options=p.parse_args()
 if shutil.disk_usage(BASE).free<24*1024*1024:raise RuntimeError("not_enough_disk")
 before=original_names()
 original={}
 for key,path in ASSETS.items():
  if path.is_symlink() or not path.is_file():raise RuntimeError("unknown_asset_"+key)
  original[key]=(path.read_bytes(),path.stat())
 fresh=patched(original["js"][0],remote(BASE_SHA),remote(NEW_SHA))
 targets={"js":fresh}
 for key in ("people","hub","entry","shell"):
  raw=original[key][0]
  n=raw.count(OLD_TAG.encode())
  if not 1<=n<=15:raise RuntimeError("unexpected_v60_route_"+key)
  targets[key]=raw.replace(OLD_TAG.encode(),NEW_TAG.encode())
 if not options.apply:
  print("SECURITY_PEOPLE_V62_DRY_RUN_PASS "+json.dumps({
   "originals":len(before),"new_sha256":sha(fresh),
   "ui_files":list(ASSETS),"camera_changed":False,
   "reviews_changed":False},sort_keys=True),flush=True)
  return
 folder=BACKUP/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,(data,_) in original.items():
  dest=folder/(key+"-previous")
  dest.write_bytes(data);os.chmod(dest,0o600)
  if sha(dest.read_bytes())!=sha(data):raise RuntimeError("backup_mismatch")
 changed=[]
 try:
  for key,path in ASSETS.items():
   old,meta=original[key]
   if path.read_bytes()!=old:raise RuntimeError("concurrent_asset_edit_"+key)
   if old!=targets[key]:
    atom(path,targets[key],meta);changed.append(key)
  served={}
  for key,path in ASSETS.items():
   uri="http://127.0.0.1:8123/local/"+path.relative_to(BASE).as_posix()+"?v="+NEW_TAG
   raw=get(uri,950000)
   if sha(raw)!=sha(targets[key]):raise RuntimeError("ha_http_readback_"+key)
   served[key]=sha(raw)[:16]
  after=original_names()
  if not before.issubset(after):raise RuntimeError("originals_regressed")
  print("SECURITY_PEOPLE_V62_DEPLOY_VERIFIED "+json.dumps({
   "originals_before":len(before),"originals_after":len(after),
   "source_sha256":sha(fresh),"served_sha16":served,
   "changed":changed,"rollback":str(folder),
   "camera_modified":False,"reviews_modified":False,
   "identity_automation_enabled":False},sort_keys=True),flush=True)
 except BaseException:
  for key in reversed(changed):
   try:atom(ASSETS[key],*original[key])
   except Exception as error:print("SECURITY_PEOPLE_V62_ROLLBACK_ERROR",key,str(error)[:90],flush=True)
  raise
if __name__=="__main__":main()
