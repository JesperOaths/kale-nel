#!/usr/bin/env python3
"""V23: forward only authenticated, bounded RGB565 frame-chunk requests.

C720P's private port 8794 previously dropped the rgb_prepare/rgb_pack query,
so the Security GPU viewer received original MP4 bytes instead of JSON/chunks.
Keep 8794's existing authorization, upstream allowlist, byte-range behavior,
and all other routes unchanged. Atomic backup, restart and rollback.
"""
from pathlib import Path
import datetime as dt
import json
import os
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-rgb565-relay-v23")
SERVICE="c720p-lan-camera-relay.service"
CLIP="motion_1791739041453.mp4"
OLD="  suffix=('?playback='+playback) if playback in ('prepare','hub') else ''"
MARKER="C720P_AUTHENTICATED_RGB565_RELAY_V23"
NEW="""  # C720P_AUTHENTICATED_RGB565_RELAY_V23: no arbitrary query passthrough
  if playback in ('rgb_prepare','rgb_pack'):
   chunks=q.get('chunk') or ['0']
   if len(chunks)!=1 or not re.fullmatch(r'(?:[0-9]|[1-5][0-9])',chunks[0]):
    return self.empty(400)
   suffix='?playback='+playback+'&chunk='+chunks[0]
  else:
   suffix=('?playback='+playback) if playback in ('prepare','hub') else ''"""

def request(path,range_header=None):
 headers={"Range":range_header} if range_header else {}
 req=urllib.request.Request("http://127.0.0.1:8794"+path,headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=14) as r:
   return r.status,r.headers.get("Content-Type",""),r.read(2000000)
 except urllib.error.HTTPError as error:
  return error.code,error.headers.get("Content-Type",""),error.read(2000000)

def service(action):
 subprocess.run(["systemctl","--user",action,SERVICE],check=True,
                capture_output=True,text=True,timeout=25)

def check(min_count):
 status,content,body=request("/new/api/saved")
 if status!=200 or not content.startswith("application/json"):
  raise RuntimeError("microSD_catalog_regressed")
 data=json.loads(body)
 if data.get("archive_mode")!="S9-microSD-only" or len(data.get("events",[]))<min_count:
  raise RuntimeError("indexed_clips_regressed")
 path="/new/saved/clip/"+CLIP
 code,ctype,payload=request(path+"?playback=rgb_prepare&chunk=0")
 if code!=200 or not ctype.startswith("application/json"):
  raise RuntimeError("rgb_prepare_still_not_JSON")
 result=json.loads(payload)
 if result.get("ok") is not True or result.get("state") not in (
     "ready","preparing","preparing_source","queued"):
  raise RuntimeError("rgb_prepare_invalid_response")
 code,ctype,payload=request(path+"?playback=rgb_pack&chunk=0")
 if code==200 and not ctype.startswith("application/octet-stream"):
  raise RuntimeError("rgb_pack_still_original_video")
 if code==409 and not ctype.startswith("application/json"):
  raise RuntimeError("rgb_pack_non_json_not_ready")
 if code not in (200,409):
  raise RuntimeError("rgb_pack_unexpected_status_"+str(code))
 pack_code=code
 code,ctype,payload=request(path+"?playback=prepare")
 if code!=200 or not ctype.startswith("application/json"):
  raise RuntimeError("standard_prepare_regressed")
 code,ctype,payload=request(path,"bytes=0-1023")
 if code!=206 or not ctype.startswith("video/mp4") or len(payload)!=1024:
  raise RuntimeError("original_byte_seek_regressed")
 return {"indexed_clips":len(data["events"]), "rgb_prepare_state":result["state"],
         "rgb_pack_http":pack_code,
         "standard_prepare":True,"original_byte_seek":True}

def atomic(data,st):
 fd,name=tempfile.mkstemp(prefix=".s9-relay-v23-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(name,stat.S_IMODE(st.st_mode))
  try:os.chown(name,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(name,TARGET)
 finally:
  if os.path.exists(name):os.unlink(name)

def main():
 if not TARGET.is_file() or TARGET.is_symlink():
  raise RuntimeError("relay_missing_or_unsafe")
 service("is-active")
 st=TARGET.stat()
 original=TARGET.read_bytes()
 text=original.decode()
 status,content,body=request("/new/api/saved")
 indexed=len(json.loads(body).get("events",[]))
 if status!=200 or indexed<250 or "if not self.authorized():" not in text:
  raise RuntimeError("private_relay_baseline_invalid")
 if MARKER in text:
  print("S9_GPU_RELAY_V23_ALREADY_INSTALLED",json.dumps(check(indexed)))
  return
 if text.count(OLD)!=1 or text.count("def archive(")!=1:
  raise RuntimeError("unexpected_relay_routing_contract")
 new=text.replace(OLD,NEW,1).encode()
 with tempfile.TemporaryDirectory(prefix="s9-relay-v23-compile-") as folder:
  p=Path(folder)/"validate.py";p.write_bytes(new)
  py_compile.compile(str(p),doraise=True)
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 back=BACKUP/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".py")
 back.write_bytes(original);os.chmod(back,0o600)
 if back.read_bytes()!=original or TARGET.read_bytes()!=original:
  raise RuntimeError("concurrent_edit_or_backup_failure")
 changed=False
 try:
  atomic(new,st);changed=True
  service("restart")
  for attempt in range(14):
   try:
    result=check(indexed)
    print("S9_GPU_RELAY_V23_DEPLOYED",json.dumps({
      **result,"service":"active","backup":str(back),
      "security_auth_unchanged":True,"originals_untouched":True},sort_keys=True))
    return
   except Exception:
    time.sleep(.8)
  raise RuntimeError("post_deploy_verification_failed")
 except BaseException:
  if changed:
   atomic(original,st)
   service("restart")
   print("S9_GPU_RELAY_V23_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":
 main()
