#!/usr/bin/env python3
"""Restore historical Drive catalog/media in the authenticated LAN relay.

8794 is the Home Assistant relay; 8795 owns the verified Drive archive.
Forward only GET/HEAD read-only catalog and media routes through the relay's
existing archive() method, retaining its authorized() check. Never mutate
recordings, archives, device, permissions, or authentication configuration.
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
import urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/security-drive-relay-v16")
UNIT="c720p-lan-camera-relay.service"
ANCHOR=("  m=re.fullmatch(r'/(new)/api/saved',path)\n"
        "  if m:return self.archive(m.group(1),'/api/saved',head)")
INSERT=(
 "  # SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16: after authorized(), never writes\n"
 "  m=re.fullmatch(r'/(new)/api/drive-saved',path)\n"
 "  if m:return self.archive(m.group(1),'/api/drive-saved',head)\n"
 "  m=re.fullmatch(r'/(new)/drive/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)\n"
 "  if m:return self.archive(m.group(1),'/drive/saved/'+m.group(2)+'/'+urllib.parse.quote(m.group(3)),head)\n")
MARKER="SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16"
def checksum(b):return hashlib.sha256(b).hexdigest()
def get_json(port,route,timeout=9):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{route}",timeout=timeout) as r:
  if r.status!=200:raise RuntimeError("wrong_http_status")
  data=r.read(2400000)
 doc=json.loads(data)
 if not isinstance(doc,dict) or doc.get("ok") is not True:raise RuntimeError("invalid_archive_response")
 return doc
def first_video(events):
 for event in events:
  name=str(event.get("remote_name") or "")
  if re.fullmatch(r"[A-Za-z0-9._-]{1,180}[.]mp4",name) and ".." not in name:return name
 raise RuntimeError("no_eligible_historical_mp4")
def ranged_clip(port,name):
 route=f"http://127.0.0.1:{port}/new/drive/saved/clip/{name}"
 request=urllib.request.Request(route,headers={"Range":"bytes=0-1023"})
 with urllib.request.urlopen(request,timeout=20) as r:
  chunk=r.read(1025)
  result=(r.status==206 and r.headers.get("Content-Range","").startswith("bytes 0-1023/") and
          len(chunk)==1024 and r.headers.get("Content-Type","").startswith("video/"))
 if not result:raise RuntimeError("historical_video_range_seek_failed")
 return True
def service(*args):
 p=subprocess.run(["systemctl","--user",*args,UNIT],capture_output=True,text=True,timeout=20)
 if p.returncode:raise RuntimeError("lan_relay_service_failed")
 return p.stdout.strip()
def atomic(path,blob,st):
 fd,tmp=tempfile.mkstemp(prefix=".security-drive-v16-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as h:h.write(blob);h.flush();os.fsync(h.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode))
  try:os.chown(tmp,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def verify(count,name):
 if service("is-active")!="active":raise RuntimeError("relay_not_active")
 drive=get_json(8794,"/new/api/drive-saved")
 saved=get_json(8794,"/new/api/saved")
 live=get_json(8794,"/new/api/live-person-watch")
 if len(drive.get("events",[]))<count or saved.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("one_of_the_archives_unavailable")
 if live.get("camera_mode") not in ("watching","recording"):raise RuntimeError("camera_health_regressed")
 ranged_clip(8794,name)
 return {"drive_count":len(drive["events"]),"microSD_count":len(saved.get("events",[])),
         "drive_mp4_byte_seek":True,"camera_mode":live.get("camera_mode")}
def main():
 if TARGET.is_symlink() or not TARGET.is_file():raise RuntimeError("relay_source_missing")
 if service("is-active")!="active":raise RuntimeError("relay_previously_inactive")
 original=TARGET.read_bytes();st=TARGET.stat();text=original.decode("utf-8")
 if "SECURITY_NATIVE_READONLY_TELEMETRY_V14" not in text or "if not self.authorized():" not in text:
  raise RuntimeError("missing_authenticated_relay_baseline")
 baseline=get_json(8794,"/new/api/saved")
 upstream=get_json(8795,"/new/api/drive-saved")
 if baseline.get("archive_mode")!="S9-microSD-only" or not isinstance(upstream.get("events"),list):
  raise RuntimeError("archive_baseline_invalid")
 count=len(upstream["events"]);name=first_video(upstream["events"])
 ranged_clip(8795,name)
 if MARKER in text:
  report=verify(count,name)
  print("SECURITY_DRIVE_ARCHIVE_V16_VERIFIED "+json.dumps({"already_installed":True,**report}),flush=True)
  return
 if text.count(ANCHOR)!=1 or text.count("def archive(")!=1:
  raise RuntimeError("unexpected_routing_contract")
 patched=text.replace(ANCHOR,INSERT+ANCHOR,1).encode()
 with tempfile.TemporaryDirectory(prefix="drive-v16-compile-") as tmp:
  p=Path(tmp)/"relay.py";p.write_bytes(patched);py_compile.compile(str(p),doraise=True)
 BACKUPS.mkdir(parents=True,exist_ok=True);os.chmod(BACKUPS,0o700)
 backup=BACKUPS/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 backup.write_bytes(original);os.chmod(backup,0o600)
 if backup.read_bytes()!=original or TARGET.read_bytes()!=original:raise RuntimeError("backup_or_concurrent_update_invalid")
 changed=False
 try:
  atomic(TARGET,patched,st);changed=True;service("restart")
  for i in range(20):
   try:
    result=verify(count,name)
    print("SECURITY_DRIVE_ARCHIVE_V16_VERIFIED "+json.dumps({
     "already_installed":False,"before_sha256":checksum(original),"source_sha256":checksum(patched),
     "backup":str(backup),"service":"active","media_preserved":True,**result}),flush=True)
    return
   except Exception:time.sleep(1)
  raise RuntimeError("relay_post_restart_validation_failed")
 except BaseException:
  if changed:
   try:
    atomic(TARGET,original,st);service("restart")
    get_json(8794,"/new/api/saved")
    print("SECURITY_DRIVE_ARCHIVE_V16_ROLLED_BACK",flush=True)
   except Exception:print("SECURITY_DRIVE_ARCHIVE_V16_MANUAL_REPAIR_REQUIRED",flush=True)
  raise
if __name__=="__main__":main()
