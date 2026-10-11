#!/usr/bin/env python3
"""Guarded Security Archive source split: historical Drive versus S9 microSD.

Only the C720P HTTP proxy Python extension and three HTML pages change.
Original recordings and Android camera are not modified. Restore on failed checks.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

H=Path("/home/jespern/c720p-home-hub")
WWW=Path("/opt/homeassistant/config/www")
PROXY=H/"bin/s9_sd_proxy_extension.py"
DRIVE=WWW/"c720p-drive-saved.html"
ARCHIVE=WWW/"frontyard-security-new/security-archive-v7.html"
ROOT=WWW/"c720p-surveillance.html"
BACKUP=H/"backups/security-drive-archive-v9"
UNIT="c720p-drive-security-archive.service"
HOST="http://127.0.0.1:8795"
OLD_ROUTE='  if path=="/new/api/saved":'
NEW_ROUTE='''  if path=="/new/api/drive-saved":
   before=self.path
   try:
    self.path="/new/api/saved"+("?" + url.query if url.query else "")
    return original(self)
   finally:self.path=before
  legacy_clip=re.fullmatch(r"/new/drive/saved/clip/([A-Za-z0-9._-]{1,180}[.]mp4)",path)
  legacy_snap=re.fullmatch(r"/new/drive/saved/snap/([A-Za-z0-9._-]{1,180}[.]jpg)",path)
  if legacy_clip or legacy_snap:
   before=self.path
   try:
    relative="clip/"+legacy_clip.group(1) if legacy_clip else "snap/"+legacy_snap.group(1)
    self.path="/new/saved/"+relative
    return original(self)
   finally:self.path=before
'''
OLD_ROOT="const ARCHIVE='/local/frontyard-security-new/security-archive-v7.html';"
NEW_ROOT="const ARCHIVE='/local/frontyard-security-new/security-archive-v7.html?v=drive-archive-v9';"
OLD_IFRAME="SECURITY_ARCHIVE_DRIVE_V8"
NEW_IFRAME="SECURITY_ARCHIVE_DRIVE_V9"
PATHS=(PROXY,DRIVE,ARCHIVE,ROOT)

def replace_once(src,old,new,name):
 if src.count(old)!=1:raise RuntimeError("unexpected_"+name+"_anchor")
 return src.replace(old,new,1)

def req(path,timeout=30,headers=None):
 request=urllib.request.Request(HOST+path,headers=headers or {})
 with urllib.request.urlopen(request,timeout=timeout) as response:
  data=response.read(3*1024*1024)
  return response.status,dict(response.headers),data

def index(path,timeout=45):
 status,head,body=req(path,timeout=timeout)
 if status!=200:raise RuntimeError("index_http_status")
 doc=json.loads(body)
 if not isinstance(doc,dict) or doc.get("ok") is not True or not isinstance(doc.get("events"),list):
  raise RuntimeError("invalid_archive_index")
 return doc

def micro():
 data=index("/new/api/saved")
 if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("S9_index_changed")
 return len(data["events"])

def stored_video_test(path, expected=None):
 status,headers,prefix=req(path,timeout=65,headers={"Range":"bytes=0-31"})
 if status!=206 or len(prefix)!=32 or "video/mp4" not in headers.get("Content-Type",""):
  raise RuntimeError("archive_range_playback_failed")
 if not headers.get("Content-Range","").startswith("bytes 0-31/"):
  raise RuntimeError("archive_content_range_missing")
 if expected and prefix[4:8] not in (b"ftyp",b"moov",b"mdat",b"free",b"wide"):
  raise RuntimeError("unexpected_MP4_header")
 return "HTTP_206"

def published(rel,blob):
 request=urllib.request.Request("http://127.0.0.1:8123/local/"+rel+"?v=verify-drive-v9")
 with urllib.request.urlopen(request,timeout=20) as response:
  actual=response.read(3*1024*1024)
 if hashlib.sha256(actual).digest()!=hashlib.sha256(blob).digest():
  raise RuntimeError("homeassistant_page_mismatch")

def atomic(path,data,st):
 fd,name=tempfile.mkstemp(prefix=".archive-v9-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(name,stat.S_IMODE(st.st_mode))
  try:os.chown(name,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)

def run(*args,timeout=50):
 return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout).stdout.strip()

def main():
 for p in PATHS:
  if p.is_symlink() or not p.is_file():raise RuntimeError("expected_hub_file_missing")
 old={p:p.read_bytes() for p in PATHS}
 mode={p:p.stat() for p in PATHS}
 proxy=old[PROXY].decode("utf-8")
 drive=old[DRIVE].decode("utf-8")
 archive=old[ARCHIVE].decode("utf-8")
 root=old[ROOT].decode("utf-8")
 before_sd=micro()
 already=(NEW_ROUTE.strip() in proxy and "/api/drive-saved?t=" in drive and
          NEW_IFRAME in archive and NEW_ROOT in root)
 if already:
  check()
  print("ARCHIVE_DRIVE_V9_ALREADY_VERIFIED",flush=True)
  return
 proxy=replace_once(proxy,OLD_ROUTE,NEW_ROUTE+OLD_ROUTE,"proxy")
 drive=replace_once(drive,"/api/saved?t=","/api/drive-saved?t=","drive_index")
 drive=replace_once(drive,"/saved/clip/","/drive/saved/clip/","drive_clip")
 drive=replace_once(drive,"/saved/snap/","/drive/saved/snap/","drive_snap")
 archive=replace_once(archive,OLD_IFRAME,NEW_IFRAME,"archive_embed")
 root=replace_once(root,OLD_ROOT,NEW_ROOT,"root_embed")
 new={PROXY:proxy.encode(),DRIVE:drive.encode(),ARCHIVE:archive.encode(),ROOT:root.encode()}
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 folder=BACKUP/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 for p in PATHS:
  target=folder/p.name
  target.write_bytes(old[p]);os.chmod(target,0o600)
  if target.read_bytes()!=old[p]:raise RuntimeError("backup_verify_failed")
 # Validate new Python module with an isolated temp file before touching the live proxy.
 with tempfile.NamedTemporaryFile(prefix="s9-drive-proxy-",suffix=".py",delete=False) as f:
  staged=Path(f.name);f.write(new[PROXY])
 try:run("/usr/bin/python3","-m","py_compile",str(staged),timeout=15)
 finally:staged.unlink(missing_ok=True)
 changed=[]
 try:
  for p in PATHS:
   atomic(p,new[p],mode[p]);changed.append(p)
  run("systemctl","--user","restart",UNIT,timeout=50)
  result=None
  for i in range(5):
   try:result=check(before_sd);break
   except Exception:
    if i==4:raise
    time.sleep(3)
  for p in (DRIVE,ARCHIVE,ROOT):
   published(str(p.relative_to(WWW)),new[p])
  print("ARCHIVE_DRIVE_V9_VERIFIED "+json.dumps({
   **result,"backup":str(folder),"original_media_changed":False,
   "camera_settings_changed":False}),flush=True)
 except BaseException as exc:
  for p in reversed(changed):
   try:atomic(p,old[p],mode[p])
   except Exception as rollback_error:
    print("ARCHIVE_V9_RESTORE_FAILED",p.name,type(rollback_error).__name__,flush=True)
  try:run("systemctl","--user","restart",UNIT,timeout=50)
  except Exception:pass
  print("ARCHIVE_DRIVE_V9_ROLLED_BACK",type(exc).__name__,str(exc)[:240],flush=True)
  raise

def check(before_sd=0):
 now_sd=micro()
 if now_sd < before_sd:raise RuntimeError("microSD_recordings_lost")
 old=index("/new/api/drive-saved",timeout=60)
 if old.get("archive_mode")=="S9-microSD-only":raise RuntimeError("drive_list_shows_microSD")
 rows=old.get("events",[])
 if not rows:raise RuntimeError("no_historical_drive_recordings")
 valid=[x for x in rows if re.fullmatch(r"[A-Za-z0-9._-]{1,180}[.]mp4",str(x.get("remote_name","")))]
 if not valid:raise RuntimeError("no_historical_drive_MP4")
 selection=valid[0]
 video=stored_video_test("/new/drive/saved/clip/"+selection["remote_name"],expected=True)
 dates=sorted({str(x.get("timestamp",""))[:10] for x in rows if x.get("timestamp")})
 return {"drive_recordings":len(rows),"drive_dates":len(dates),"oldest_date":dates[0] if dates else None,
         "newest_date":dates[-1] if dates else None,"S9_microSD_recordings":now_sd,
         "historical_video_seek":video}

if __name__=="__main__":main()
