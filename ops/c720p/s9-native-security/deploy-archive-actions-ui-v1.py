#!/usr/bin/env python3
"""Surgical Archive thumbnail action rollout, retaining all existing page fixes.

Adds one private companion script and only two data annotations to existing
microSD/Drive card renderers. No recording, S9+ APK or gallery changes.
"""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import urllib.request

WWW=Path("/opt/homeassistant/config/www")
HTML=WWW/"frontyard-security-new/security-archive-v7.html"
JS=WWW/"frontyard-security-new/archive-card-actions-v1.js"
ROOT=WWW/"c720p-surveillance.html"
BACK=Path("/home/jespern/c720p-home-hub/backups/security-archive-card-actions-ui-v1")
PIN="1ed526dfa13a49910c384200eaa9fb3556db7614"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+PIN+"/ops/c720p/s9-native-security/archive-card-actions-v1.js"
MARKER="ARCHIVE_ACTIONS_V1_20261012"
LOCAL_ANCHOR="b.addEventListener('click',()=>play(r));preview(img,r);return b;}"
DRIVE_ANCHOR="btn.addEventListener('click',()=>playDrive(r));drivePreview(img,r);"
LOCAL_PATCH="""b.dataset.archiveSource='sd';b.dataset.archiveName=name(r);
b.dataset.archiveInfo=JSON.stringify({timestamp:r.timestamp,size:r.size,person_count:r.person_count,
 person_status:r.person_status,scene_category:r.scene_category,person_score:r.person_score,
 face_snapshots_saved:r.face_snapshots_saved,review_backend:r.review_backend});
"""+LOCAL_ANCHOR
DRIVE_PATCH="""btn.dataset.archiveSource='drive';btn.dataset.archiveName=driveVideoName(r);
btn.dataset.archiveInfo=JSON.stringify({timestamp:r.timestamp,size:r.size,person_count:r.person_count,
 person_status:r.person_status,person_score:r.person_confidence,scene_category:r.person_status});
"""+DRIVE_ANCHOR
INJECT='<script defer src="/local/frontyard-security-new/archive-card-actions-v1.js?v='+MARKER+'"></script>'
IFRAME=re.compile(r'(/local/frontyard-security-new/security-archive-v7[.]html[?]v=)([A-Za-z0-9_-]+)')
VERSION="archive-thumbnail-actions-v11-20261012"

def sha(data):return hashlib.sha256(data).hexdigest()
def get(url,maxbytes=200000):
 with urllib.request.urlopen(url,timeout=25) as r:
  data=r.read(maxbytes+1)
 if len(data)>maxbytes:raise RuntimeError("response_too_large")
 return data
def atomic(path,data,st):
 fd,tmp=tempfile.mkstemp(prefix=".s9-archive-actions-v1-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode))
  try:os.chown(tmp,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def health():
 with urllib.request.urlopen("http://127.0.0.1:8794/new/api/saved",timeout=15) as r:
  sd=json.load(r)
 with urllib.request.urlopen("http://127.0.0.1:8794/new/api/drive-saved",timeout=15) as r:
  drive=json.load(r)
 if sd.get("archive_mode")!="S9-microSD-only" or len(sd.get("events",[]))<200 or len(drive.get("events",[]))<120:
  raise RuntimeError("archive_sources_unhealthy")
 return len(sd["events"]),len(drive["events"])
def main():
 if not re.fullmatch("[0-9a-f]{40}",PIN):raise RuntimeError("source_not_pinned")
 for p in (HTML,ROOT):
  if not p.is_file() or p.is_symlink():raise RuntimeError("live_html_missing")
 old={p:p.read_bytes() if p.exists() else None for p in (HTML,ROOT,JS)}
 st={p:p.stat() if p.exists() else None for p in (HTML,ROOT,JS)}
 original=old[HTML].decode();root=old[ROOT].decode()
 if (old[JS] and MARKER.encode() in old[JS] and INJECT in original
     and "data-archive-name" in original):
  print("ARCHIVE_ACTIONS_UI_ALREADY_INSTALLED",json.dumps({"catalogs":health()}));return
 if original.count(LOCAL_ANCHOR)!=1 or original.count(DRIVE_ANCHOR)!=1 or original.count("</head>")!=1:
  raise RuntimeError("archive_card_renderer_changed")
 if "C720PSecureRelay" not in original or "/new/api/drive-saved" not in original:
  raise RuntimeError("archive_security_contract_missing")
 if len(IFRAME.findall(root))!=1:raise RuntimeError("security_shell_archive_frame_missing")
 js=get(URL)
 if not 6000<len(js)<30000 or MARKER.encode() not in js or b"/new/api/sd/delete" not in js:
  raise RuntimeError("unexpected_companion_js")
 updated=original.replace(LOCAL_ANCHOR,LOCAL_PATCH,1).replace(DRIVE_ANCHOR,DRIVE_PATCH,1)
 updated=updated.replace("</head>",INJECT+"\n</head>",1)
 patched_root=IFRAME.sub(lambda m:m.group(1)+VERSION,root,count=1)
 changes={HTML:updated.encode(),ROOT:patched_root.encode(),JS:js}
 before=health()
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 for p,b in old.items():
  if b is not None:
   backup=folder/p.name;backup.write_bytes(b);os.chmod(backup,0o600)
   if sha(backup.read_bytes())!=sha(b):raise RuntimeError("backup_hash_failure")
 done=[]
 try:
  for p,data in changes.items():
   if p.exists() and old[p]!=p.read_bytes():raise RuntimeError("concurrent_page_change")
   atomic(p,data,st[p] if st[p] else HTML.stat());done.append(p)
  for p in (HTML,ROOT,JS):
   u="http://127.0.0.1:8123/local/"+p.relative_to(WWW).as_posix()+"?v="+VERSION
   if sha(get(u))!=sha(changes[p]):raise RuntimeError("HA_page_http_hash_mismatch:"+p.name)
  after=health()
  if after[0]<before[0] or after[1]<before[1]:raise RuntimeError("recording_catalog_changed")
  print("ARCHIVE_THUMBNAIL_ACTIONS_UI_DEPLOYED",json.dumps({
   "script":str(JS),"archive":str(HTML),"shell":str(ROOT),
   "sd":after[0],"drive":after[1],"backup":str(folder),"source_ref":PIN,
   "media_modified":False,"source_folders_preserved":True},sort_keys=True))
 except BaseException:
  for p in reversed(done):
   if old[p] is None:p.unlink(missing_ok=True)
   else:atomic(p,old[p],st[p])
  print("ARCHIVE_THUMBNAIL_ACTIONS_UI_ROLLED_BACK")
  raise

if __name__=="__main__":main()
