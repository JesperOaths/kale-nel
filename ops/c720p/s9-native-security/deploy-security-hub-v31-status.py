#!/usr/bin/env python3
"""Activate versioned V31 status UI with exact-source, recording-safe rollback.
Only changes two HTML script references and installs an additive JS asset.
No camera/relay restart, media write, model, person review or signed-action change.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import urllib.request

WEB=Path("/opt/homeassistant/config/www")
JS=WEB/"frontyard-security-new/security-hub-v31.js"
STAGE=Path("/tmp/chat3-security-hub-v31.js")
FILES=(
 (WEB/"frontyard-security-new/security-hub-v30.html",
  "9317a839381ad897c25c39eba674e039d2e71a8b"),
 (WEB/"c720p-surveillance.html",
  "4a97b8be34c983df4f76ed24e3837bdbdb5c3563"),
)
EXPECTED_JS="e694fd75c3db526f39be8fc2544b69c589b9c4ae"
OLD=b"security-hub-v30.js?v=private-pipeline-source-status-v1-20261021"
NEW=b"security-hub-v31.js?v=private-pipeline-safe-status-v31-20261021"
BACKUPS=Path("/home/jespern/c720p-home-hub/backups")
MIN_FREE=850*1024*1024
MIN_RAM=256*1024*1024

def gitblob(data):
 return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()

def safe_read(p,maxbytes):
 s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>maxbytes or s.st_size<10:
  raise RuntimeError("unsafe_asset_"+p.name)
 return p.read_bytes(),stat.S_IMODE(s.st_mode)

def camera_safe():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=4) as r:
  d=json.load(r)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<=39.0):
  raise RuntimeError("camera_guard_not_met")
 return d["temperature_c"]

def resources():
 st=os.statvfs("/")
 if st.f_bavail*st.f_frsize<MIN_FREE:raise RuntimeError("root_space_guard")
 with open("/proc/meminfo") as f:
  vals=dict((k.strip(),int(v.split()[0])*1024) for k,v in (x.split(":",1) for x in f))
 if vals.get("MemAvailable",0)<MIN_RAM:raise RuntimeError("available_memory_guard")
 return vals["MemAvailable"]

def atomic(p,data,mode):
 fd,tmp=tempfile.mkstemp(prefix=".chat3-v31-",dir=p.parent)
 try:
  os.fchmod(fd,mode)
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def served(url,needle):
 with urllib.request.urlopen("http://127.0.0.1:8123"+url,timeout=5) as r:
  content=r.read(140000)
  if r.status!=200 or needle not in content:raise RuntimeError("served_asset_mismatch")
 return len(content)

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--apply",action="store_true");args=ap.parse_args()
 before=[]
 for p,blob in FILES:
  data,mode=safe_read(p,150000)
  if gitblob(data)==blob and data.count(OLD)==1 and NEW not in data:before.append((p,data,mode))
  elif data.count(NEW)==1 and data.count(OLD)==0:before.append((p,data,mode))
  else:raise RuntimeError("concurrent_or_unknown_html_version_"+p.name)
 src,_=safe_read(STAGE,100000)
 if gitblob(src)!=EXPECTED_JS:raise RuntimeError("v31_source_digest_mismatch")
 if JS.exists() or JS.is_symlink():
  data,_=safe_read(JS,100000)
  if gitblob(data)!=EXPECTED_JS:raise RuntimeError("v31_asset_conflict")
 if all(NEW in data for _,data,_ in before):
  served("/local/frontyard-security-new/security-hub-v31.js",b"storageAlert")
  print(json.dumps({"status":"already_installed","js_git_blob":EXPECTED_JS}));return
 if any(NEW in data for _,data,_ in before):raise RuntimeError("partial_existing_deployment")
 mem=resources();temp=camera_safe()
 print(json.dumps({"stage":"preflight","js_git_blob":EXPECTED_JS,
  "memory_available_bytes":mem,"camera_temp_c":temp,"html_sources_verified":True}),flush=True)
 if not args.apply:return
 camera_safe();resources()
 stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACKUPS/("security-v31-chat3-"+stamp)
 backup.mkdir(mode=0o700)
 os.chmod(backup,0o700)
 for n,(p,data,mode) in enumerate(before):
  atomic(backup/("before-"+str(n)+".html"),data,0o600)
 old_js=None
 if JS.exists():old_js,_=safe_read(JS,100000)
 changed=[]
 try:
  if not JS.exists():atomic(JS,src,0o644)
  for p,data,mode in before:
   if data.count(OLD)!=1:raise RuntimeError("html_changed_before_write")
   atomic(p,data.replace(OLD,NEW),mode);changed.append((p,data,mode))
  for p,data,mode in before:
   now,_=safe_read(p,150000)
   if now!=data.replace(OLD,NEW):raise RuntimeError("installed_html_readback_mismatch")
  data,_=safe_read(JS,100000)
  if gitblob(data)!=EXPECTED_JS:raise RuntimeError("installed_js_readback_mismatch")
  served("/local/frontyard-security-new/security-hub-v31.js",b"storageAlert")
  served("/local/frontyard-security-new/security-hub-v30.html",NEW)
  served("/local/c720p-surveillance.html",NEW)
 except BaseException:
  for p,data,mode in reversed(changed):atomic(p,data,mode)
  if old_js is None and JS.exists():JS.unlink()
  raise
 print(json.dumps({"status":"deployed","backup":str(backup),
  "v31_git_blob":EXPECTED_JS,"html_updated":2,
  "old_v30_js_preserved":True,"original_media_untouched":True}),flush=True)

if __name__=="__main__":main()
