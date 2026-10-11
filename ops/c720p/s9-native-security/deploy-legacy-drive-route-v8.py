#!/usr/bin/env python3
"""Restore the historical Drive catalog inside Security Archive without touching video files.

The existing signed /new/api/saved path accepts archive=drive and delegates only
that listing to the original Drive handler. The default SD catalog is unchanged.
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
import urllib.parse
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
PY=BASE/"bin/s9_sd_proxy_extension.py"
HTML=Path("/opt/homeassistant/config/www/c720p-drive-saved.html")
ARCHIVE=Path("/opt/homeassistant/config/www/frontyard-security-new/security-archive-v7.html")
BACKUPS=BASE/"backups/legacy-drive-catalog-v8"
SVC="c720p-drive-security-archive.service"
URL="http://127.0.0.1:8795/new/api/saved"
OLD='  if path=="/new/api/saved":'
NEW='''  if path=="/new/api/saved":
   # Explicit historical Drive opt-in; unsigned public routes are not introduced.
   if urllib.parse.parse_qs(url.query).get("archive")==["drive"]:
    return original(self)'''
OLD_FETCH="/api/saved?t="
NEW_FETCH="/api/saved?archive=drive&t="

def run(*args, timeout=35):
 return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout).stdout.strip()

def jget(url,timeout=18):
 with urllib.request.urlopen(url,timeout=timeout) as response:
  if response.status != 200:raise RuntimeError("bad_archive_http_status")
  obj=json.load(response)
 if not isinstance(obj,dict) or obj.get("ok") is not True or not isinstance(obj.get("events"),list):
  raise RuntimeError("invalid_archive_response")
 return obj

def atomic(data,dest,st):
 fd,fn=tempfile.mkstemp(prefix=".drive-archive-v8-",dir=dest.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(fn,stat.S_IMODE(st.st_mode))
  try:os.chown(fn,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(fn,dest)
 finally:
  if os.path.exists(fn):os.unlink(fn)

def sd():
 j=jget(URL)
 if j.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("current_microSD_route_changed")
 return len(j["events"])

def drive():
 j=jget(URL+"?archive=drive")
 if j.get("archive_mode")=="S9-microSD-only":
  raise RuntimeError("historical_drive_still_shadowed_by_SD")
 events=j["events"]
 if not events:
  raise RuntimeError("historical_drive_catalog_empty_or_unavailable")
 return events

def check_video(events):
 items=[r for r in events if isinstance(r,dict) and
        re.fullmatch(r"[A-Za-z0-9._-]{1,180}\\.mp4",str(r.get("remote_name",""))) ]
 if not items:return "no_mp4_indexed"
 item=items[0]
 url="http://127.0.0.1:8795/new/saved/clip/"+urllib.parse.quote(item["remote_name"])
 req=urllib.request.Request(url,headers={"Range":"bytes=0-15"})
 with urllib.request.urlopen(req,timeout=35) as response:
  content=response.read(16)
  if response.status!=206 or len(content)!=16:
   raise RuntimeError("legacy_drive_range_playback_failed")
 return "HTTP_206_16_bytes"

def main():
 if any(p.is_symlink() or not p.is_file() for p in (PY,HTML,ARCHIVE)):
  raise RuntimeError("expected_security_files_missing")
 if 'id="driveTab"' not in ARCHIVE.read_text():
  raise RuntimeError("archive_v8_page_not_installed")
 original_py=PY.read_bytes()
 original_html=HTML.read_bytes()
 py=original_py.decode("utf-8")
 html=original_html.decode("utf-8")
 old_sd=sd()
 if NEW in py and NEW_FETCH in html:
  rows=drive()
  print("ARCHIVE_DRIVE_CATALOG_V8_ALREADY_ACTIVE "+json.dumps({
    "drive_indexed":len(rows),"sd_indexed":old_sd,"range":check_video(rows)}),flush=True)
  return
 if py.count(OLD)!=1 or py.count(NEW)!=0:
  raise RuntimeError("unexpected_proxy_source_anchor")
 if html.count(OLD_FETCH)!=1 or NEW_FETCH in html or "C720PSecureRelay" not in html:
  raise RuntimeError("unexpected_legacy_gallery_source_anchor")
 new_py=py.replace(OLD,NEW,1)
 new_html=html.replace(OLD_FETCH,NEW_FETCH,1)
 if "urllib.parse.urlsplit(self.path)" not in py or "original=H.go" not in py:
  raise RuntimeError("unsupported_extension_version")
 if "saved/delete" in NEW_FETCH:
  raise RuntimeError("unexpected_mutating_gallery_patch")
 BACKUPS.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUPS,0o700)
 folder=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 for name,data in (("extension-before.py",original_py),("drive-gallery-before.html",original_html)):
  p=folder/name;p.write_bytes(data);os.chmod(p,0o600)
  if p.read_bytes()!=data:raise RuntimeError("backup_verification_failed")
 info_py,info_html=PY.stat(),HTML.stat()
 changed=[]
 try:
  atomic(new_py.encode(),PY,info_py);changed.append(PY)
  run("/usr/bin/python3","-m","py_compile",str(PY),timeout=20)
  atomic(new_html.encode(),HTML,info_html);changed.append(HTML)
  run("systemctl","--user","restart",SVC,timeout=45)
  for _ in range(5):
   try:
    new_sd=sd();rows=drive();break
   except Exception:
    time.sleep(2)
  else:raise RuntimeError("archive_source_split_not_healthy")
  if new_sd<old_sd:raise RuntimeError("microSD_catalog_lost_rows")
  sample=check_video(rows)
  ha_url="http://127.0.0.1:8123/local/c720p-drive-saved.html?v=drive-archive-v8"
  with urllib.request.urlopen(ha_url,timeout=15) as rr:
   html_live=rr.read(400000)
  if hashlib.sha256(html_live).digest()!=hashlib.sha256(new_html.encode()).digest():
   raise RuntimeError("home_assistant_gallery_not_published")
  print("ARCHIVE_DRIVE_CATALOG_V8_VERIFIED "+json.dumps({
   "drive_indexed":len(rows),"sd_before":old_sd,"sd_after":new_sd,
   "drive_range":sample,"backup":str(folder),
   "camera_changed":False,"media_changed":False}),flush=True)
 except BaseException as e:
  for p in reversed(changed):
   data,st=(original_py,info_py) if p==PY else (original_html,info_html)
   atomic(data,p,st)
  try:run("systemctl","--user","restart",SVC,timeout=45)
  except Exception:pass
  print("ARCHIVE_DRIVE_CATALOG_V8_ROLLBACK "+type(e).__name__,flush=True)
  raise

if __name__=="__main__":
 main()
