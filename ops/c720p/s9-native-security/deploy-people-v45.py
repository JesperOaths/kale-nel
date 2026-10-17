#!/usr/bin/env python3
"""Safely install independent People & Faces V45 on the *actual* HA Security tab.

Immutable Git commit source, transactional disk backups, verified HTTP readback,
and exact route version bump. Does NOT touch S9 APK, 4K media, scan indices,
people approvals, private review API, or any other Security tab.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
DEST={
 "html":ROOT/"security-people-v45.html",
 "js":ROOT/"security-people-v45.js",
 "hub":ROOT/"security-hub-v30.js",
 "entry":ROOT/"security-hub-v30.html",
}
ORIG={
 "html":"ops/c720p/s9-native-security/security-people-v45.html",
 "js":"ops/c720p/s9-native-security/security-people-v45.js",
}
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-people-v45-real-route")
OLD="security-people-v45.html?v=s9pf-v45-20261017&"
NEW="security-people-v45.html?v=s9pf-v45-20261017-review-recheck-r2&"
ENTRY_OLD="security-hub-v30.js?v=people-faces-v45-20261017"
ENTRY_NEW="security-hub-v30.js?v=people-faces-v45-20261017-review-recheck-r2"
MARK="s9-people-v45-real-route"
def digest(b):return hashlib.sha256(b).hexdigest()
def get(url,limit=220000):
 with urllib.request.urlopen(url,timeout=35) as r:
  if r.status!=200:raise RuntimeError("source_http_unavailable")
  b=r.read(limit+1)
 if not 70<len(b)<=limit:raise RuntimeError("http_bounded_read_invalid")
 return b
def archive():
 data=json.loads(get("http://127.0.0.1:8795/new/api/saved",1500000))
 if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_mode_invalid")
 names={e.get("clip_no") for e in data.get("events",[]) if isinstance(e,dict)}
 if len(names)<70:raise RuntimeError("archive_missing_unsafe_to_deploy")
 return names
def update(source,old,new,tag):
 if source.count(old)!=1:raise RuntimeError("unexpected_live_route_"+tag+"_"+str(source.count(old)))
 return source.replace(old,new)
def atom(path,body,prior):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix=".s9-pf-v45-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(body);f.flush();os.fsync(f.fileno())
  os.chmod(name,stat.S_IMODE(prior.st_mode) if prior else 0o644)
  if prior:
   try:os.chown(name,prior.st_uid,prior.st_gid)
   except PermissionError:pass
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 p.add_argument("--dry-run",action="store_true")
 args=p.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",args.ref):raise RuntimeError("immutable_sha_required")
 old_clips=archive()
 prior={}
 for k,path in DEST.items():
  if path.is_symlink():raise RuntimeError("symlink_refused_"+k)
  b=path.read_bytes() if path.exists() else None
  prior[k]=(b,path.stat() if b is not None else None)
 if prior["hub"][0] is None or prior["entry"][0] is None:
  raise RuntimeError("live_hub_files_missing")
 out={}
 for k,source in ORIG.items():
  b=get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+args.ref+"/"+source)
  if k=="html":
   for phrase in (b'id="reviewPreview"',b'id="reviewAlerts"',b'id="folderRecheck"',b'id="savedPreview"',b'id="faceGrid"',
                  b'id="approvalConfirmed"',b"security-people-v45.js"):
    if phrase not in b:raise RuntimeError("html_interface_contract_missing")
  else:
   for phrase in (b"clip_folders_v40",b"manual-attributes-v36",
                  b"human_confirmed:true",b"loadView()",b"fetchFaces()"):
    if phrase not in b:raise RuntimeError("js_review_contract_missing")
  out[k]=b
 hub=prior["hub"][0].decode("utf-8")
 if MARK not in hub:raise RuntimeError("expected_existing_v45_hub")
 if NEW in hub:
  out["hub"]=prior["hub"][0]
 else:
  out["hub"]=update(hub,OLD,NEW,"hub").encode("utf-8")
 entry=prior["entry"][0].decode("utf-8")
 if MARK not in entry:raise RuntimeError("expected_existing_v45_entry")
 if ENTRY_NEW in entry:
  out["entry"]=prior["entry"][0]
 else:
  out["entry"]=update(entry,ENTRY_OLD,ENTRY_NEW,"entry").encode("utf-8")
 if OLD.encode() in out["hub"] or (ENTRY_OLD+'"').encode() in out["entry"]:
  raise RuntimeError("old_route_retained_in_staged_assets")
 if args.dry_run:
  print("S9_PEOPLE_V45_LIVE_ROUTE_DRY_RUN_PASS "+json.dumps({
   "source_ref":args.ref,"originals":len(old_clips),
   "routes_patched":['hub','entry'],"new_media_written":False,
   "assets":{k:len(v) for k,v in out.items()}}),flush=True)
  return
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 name=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder=BACK/name;folder.mkdir(mode=0o700)
 for k,(b,_) in prior.items():
  if b is not None:
   save=folder/(k+"-previous")
   save.write_bytes(b);os.chmod(save,0o600)
   if save.read_bytes()!=b:raise RuntimeError("backup_not_verified_"+k)
 changed=[]
 try:
  for k,path in DEST.items():
   b,owner=prior[k]
   if b==out[k]:continue
   if (path.read_bytes() if path.exists() else None)!=b:
    raise RuntimeError("concurrent_local_edit_"+k)
   atom(path,out[k],owner);changed.append(k)
  for k,path in DEST.items():
   if digest(path.read_bytes())!=digest(out[k]):
    raise RuntimeError("installed_readback_invalid_"+k)
  served={}
  for k,path in DEST.items():
   url="http://127.0.0.1:8123/local/frontyard-security-new/"+path.name+"?version="+args.ref[:12]
   b=get(url)
   if digest(b)!=digest(out[k]):raise RuntimeError("HA_not_serving_new_version_"+k)
   served[k]=digest(b)[:16]
  if OLD.encode() in out["hub"] or (ENTRY_OLD+'"').encode() in out["entry"]:
   raise RuntimeError("old_route_retained")
  new_clips=archive()
  if not old_clips.issubset(new_clips):raise RuntimeError("archive_records_disappeared")
  print("S9_PEOPLE_FACES_V45_ACTUAL_HUB_DEPLOY_VERIFIED "+json.dumps({
   "served_route":"security-hub-v30.html -> security-hub-v30.js -> security-people-v45.html -> security-people-v45.js",
   "source_ref":args.ref,"clip_count":len(new_clips),
   "served_sha16":served,"rollback":str(folder),"original_videos_modified":False,
   "camera_modified":False,"existing_approvals_modified":False}),flush=True)
 except BaseException:
  for k in reversed(changed):
   path=DEST[k];b,owner=prior[k]
   try:
    if b is None:path.unlink(missing_ok=True)
    else:atom(path,b,owner)
   except Exception:print("S9_PEOPLE_V45_MANUAL_RESTORE_REQUIRED_"+k,flush=True)
  print("S9_PEOPLE_V45_DEPLOY_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
