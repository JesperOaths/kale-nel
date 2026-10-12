#!/usr/bin/env python3
"""Install S9+ microSD single-item delete API with no destructive test media.

Patch only the existing private relay and Archive proxy extension; an explicit
authenticated browser action is required for every clip. Backups and rollback.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
RELAY=BASE/"bin/c720p-lan-camera-relay.py"
EXT=BASE/"bin/s9_sd_proxy_extension.py"
MODULE=BASE/"bin/s9_archive_delete_v1.py"
BACK=BASE/"backups/security-archive-card-actions-v1"
PIN="__GIT_PIN__"
BASE_URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+PIN+"/ops/c720p/s9-native-security/"
MARKER="C720P_SD_EXPLICIT_DELETE_V1"
OLD_HEADERS="'Authorization,Content-Type,X-C720P-Relay-Token,X-S9-Camera-Control-Intent'"
NEW_HEADERS="'Authorization,Content-Type,X-C720P-Relay-Token,X-S9-Camera-Control-Intent,X-S9-Archive-Delete-Intent'"
ANCHOR="  m=re.fullmatch(r'/(new)/api/saved/delete',path)"
POST="""  # C720P_SD_EXPLICIT_DELETE_V1: owner action, fixed localhost upstream, no bulk.
  if path=='/new/api/sd/delete':
   if not self.origin_ok() or self.headers.get('X-S9-Archive-Delete-Intent')!='explicit-user-delete-v1':
    return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 30<=n<=512 or 'application/json' not in self.headers.get('Content-Type','').lower():
     return self.empty(400)
    body=self.rfile.read(n)
    req=urllib.request.Request('http://127.0.0.1:8795/new/api/sd/delete',
      data=body,headers={'Content-Type':'application/json'},method='POST')
    try:response=urllib.request.urlopen(req,timeout=75)
    except urllib.error.HTTPError as error:response=error
    with response:
     data=response.read(16000)
     self.send_response(response.status);self.cors()
     self.send_header('Content-Type','application/json')
     self.send_header('Cache-Control','no-store')
     self.send_header('Content-Length',str(len(data)));self.end_headers()
     self.wfile.write(data)
    return
   except Exception:
    return self.empty(502)
"""
EXT_ANCHOR=" import s9_native_camera_controls\n s9_native_camera_controls.install(H)"
EXT_REPLACEMENT=EXT_ANCHOR+"\n # C720P_SD_EXPLICIT_DELETE_V1: filter tombstones and mount read-only by default.\n import s9_archive_delete_v1\n globals()['rows']=s9_archive_delete_v1.install(H,rows,SECURITY_SD,NATIVE_SD,SD)"

def sha(b):return hashlib.sha256(b).hexdigest()
def get(url,limit=90000):
 with urllib.request.urlopen(url,timeout=30) as r:
  b=r.read(limit+1)
 if len(b)>limit:raise RuntimeError("asset_size_limit")
 return b
def json_get(port,route):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{route}",timeout=22) as r:
  return json.load(r)
def request(port,route,body):
 req=urllib.request.Request(f"http://127.0.0.1:{port}{route}",
     headers={"Content-Type":"application/json"},method="POST",data=body)
 try:r=urllib.request.urlopen(req,timeout=14)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,json.loads(r.read(30000))
def ctl(action,unit):
 subprocess.run(["systemctl","--user",action,unit],timeout=45,
    check=True,capture_output=True,text=True)
def restart():
 ctl("restart","c720p-drive-security-archive.service")
 ctl("restart","c720p-lan-camera-relay.service")
def healthy(baseline):
 last=None
 for _ in range(28):
  try:
   sd=json_get(8794,"/new/api/saved")
   dr=json_get(8794,"/new/api/drive-saved")
   if sd.get("archive_mode")!="S9-microSD-only" or len(sd["events"])<baseline[0] or len(dr["events"])<baseline[1]:
    raise RuntimeError("catalog_regression")
   code,body=request(8795,"/new/api/sd/delete",b'{"clip_no":"invalid_name","expected_bytes":10001,"confirm":"DELETE invalid_name"}')
   if code!=400 or body.get("ok") is not False:
    raise RuntimeError("invalid_deletion_rejected_wrong_status")
   ctl("is-active","c720p-drive-security-archive.service")
   ctl("is-active","c720p-lan-camera-relay.service")
   return {"sd":len(sd["events"]),"drive":len(dr["events"]),"invalid_request_rejected":True}
  except Exception as error:last=error;time.sleep(.7)
 raise RuntimeError("backend_post_install_health_failed:"+str(last))

def atomic(target,data,st):
 fd,p=tempfile.mkstemp(prefix=".archive-actions-v1-",dir=target.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(p,stat.S_IMODE(st.st_mode))
  try:os.chown(p,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(p,target)
 finally:
  if os.path.exists(p):os.unlink(p)

def main():
 if not re.fullmatch(r"[0-9a-f]{40}",PIN):
  raise RuntimeError("unpinned_source")
 for p in (RELAY,EXT):
  if not p.is_file() or p.is_symlink():raise RuntimeError("unsafe_live_backend")
 baseline=(len(json_get(8794,"/new/api/saved")["events"]),len(json_get(8794,"/new/api/drive-saved")["events"]))
 old={p:p.read_bytes() if p.exists() else None for p in (RELAY,EXT,MODULE)}
 st={p:p.stat() if p.exists() else None for p in (RELAY,EXT,MODULE)}
 relay=old[RELAY].decode();ext=old[EXT].decode()
 if MARKER in relay and MARKER in ext and old[MODULE]:
  print("ARCHIVE_DELETE_BACKEND_ALREADY_INSTALLED",json.dumps(healthy(baseline)));return
 if MARKER in relay or MARKER in ext:
  raise RuntimeError("partial_previous_install_requires_review")
 if relay.count(ANCHOR)!=1 or relay.count(OLD_HEADERS)!=1 or ext.count(EXT_ANCHOR)!=1:
  raise RuntimeError("unexpected_routing_source_changed")
 module=get(BASE_URL+"s9_archive_delete_v1.py")
 if len(module)<3500 or b"original_file_deleted" not in module or b"explicit_archive_ui" not in module:
  raise RuntimeError("unexpected_backend_module")
 patch_relay=relay.replace(ANCHOR,POST+ANCHOR,1).replace(OLD_HEADERS,NEW_HEADERS,1).encode()
 patch_ext=ext.replace(EXT_ANCHOR,EXT_REPLACEMENT,1).encode()
 updates={RELAY:patch_relay,EXT:patch_ext,MODULE:module}
 with tempfile.TemporaryDirectory(prefix="s9-archive-delete-preflight-") as tmp:
  for p,data in updates.items():
   f=Path(tmp)/p.name;f.write_bytes(data);py_compile.compile(str(f),doraise=True)
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 for p,b in old.items():
  if b is not None:
   out=folder/p.name;out.write_bytes(b);os.chmod(out,0o600)
   if out.read_bytes()!=b:raise RuntimeError("backup_integrity_error")
 changed=[]
 try:
  for p,data in updates.items():
   if p.exists() and p.read_bytes()!=old[p]:raise RuntimeError("concurrent_change")
   atomic(p,data,st[p] if st[p] else EXT.stat());changed.append(p)
  restart()
  check=healthy(baseline)
  print("SECURITY_ARCHIVE_DELETE_BACKEND_DEPLOYED",json.dumps({
   **check,"backup":str(folder),"photo_or_media_deleted":False,
   "owner_only_delete":True,"sd_filename_and_size_guard":True,
   "drive_delete_path_unchanged":True,"source_ref":PIN},sort_keys=True))
 except BaseException:
  for p in reversed(changed):
   if old[p] is None:p.unlink(missing_ok=True)
   else:atomic(p,old[p],st[p])
  try:restart()
  except Exception:pass
  print("SECURITY_ARCHIVE_DELETE_BACKEND_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":main()
