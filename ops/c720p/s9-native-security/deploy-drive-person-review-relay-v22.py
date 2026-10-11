#!/usr/bin/env python3
"""Expose only the already-scoped read-only historical person-review catalog.

8795 has finished classifying the 180 verified Drive clips, but the signed
browser LAN relay 8794 returns 404. No new write API, biometrics, or identity
endpoint is exposed. Preserve, restart, validate, roll back.
"""
import datetime as dt
import json,os,py_compile,re,stat,subprocess,tempfile,time,urllib.request
from pathlib import Path
TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-facefolder-review-relay-v22")
SERVICE="c720p-lan-camera-relay.service"
ANCHOR="  m=re.fullmatch(r'/(new)/api/drive-saved',path)\n  if m:return self.archive(m.group(1),'/api/drive-saved',head)"
MARKER="SECURITY_DRIVE_PERSON_READONLY_V22"
ADD="  # "+MARKER+" — existing authenticated LAN relay / no writes\n  m=re.fullmatch(r'/(new)/api/drive-person-review',path)\n  if m:return self.archive(m.group(1),'/api/drive-person-review',head)\n"
def fetch(port,path):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=12) as r:
  if r.status!=200:raise RuntimeError("unexpected_status")
  x=json.loads(r.read(3500000))
 if not isinstance(x,dict) or x.get("ok") is not True:raise RuntimeError("invalid_json")
 return x
def service(action):
 p=subprocess.run(["systemctl","--user",action,SERVICE],capture_output=True,text=True,timeout=22)
 if p.returncode:raise RuntimeError("relay_service_failed")
 return p.stdout.strip()
def put(source,oldstat):
 fd,tmp=tempfile.mkstemp(prefix=".security-faces-v22-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(source);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(oldstat.st_mode))
  try:os.chown(tmp,oldstat.st_uid,oldstat.st_gid)
  except PermissionError:pass
  os.replace(tmp,TARGET)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def healthy(before):
 q=fetch(8794,"/new/api/drive-person-review")
 if not isinstance(q.get("clips"),list) or len(q["clips"])<before:
  raise RuntimeError("drive_review_items_regressed")
 sd=fetch(8794,"/new/api/saved")
 if sd.get("archive_mode")!="S9-microSD-only" or not isinstance(sd.get("events"),list):
  raise RuntimeError("microSD_archive_unavailable")
 drive=fetch(8794,"/new/api/drive-saved")
 if not isinstance(drive.get("events"),list) or len(drive["events"])<160:
  raise RuntimeError("historical_drive_unavailable")
 return {"reviewed":len(q["clips"]),"microSD":len(sd["events"]),"drive":len(drive["events"])}
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("relay_file_missing")
 if service("is-active")!="active":raise RuntimeError("relay_inactive_before")
 upstream=fetch(8795,"/new/api/drive-person-review")
 if len(upstream.get("clips",[]))<170:raise RuntimeError("review_catalog_missing")
 original=TARGET.read_bytes();st=TARGET.stat();s=original.decode()
 if MARKER in s:
  print("SECURITY_DRIVE_PERSON_RELAY_V22_VERIFIED",json.dumps({"already":True,**healthy(len(upstream["clips"]))}),flush=True);return
 if s.count(ANCHOR)!=1 or "SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16" not in s:
  raise RuntimeError("unexpected_authenticated_relay_source")
 patched=s.replace(ANCHOR,ADD+ANCHOR,1).encode()
 with tempfile.TemporaryDirectory(prefix="review-v22-compile-") as d:
  p=Path(d)/"relay.py";p.write_bytes(patched);py_compile.compile(str(p),doraise=True)
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 backup=BACK/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".py")
 backup.write_bytes(original);os.chmod(backup,0o600)
 if backup.read_bytes()!=original or TARGET.read_bytes()!=original:raise RuntimeError("backup_or_concurrency_failure")
 changed=False
 try:
  put(patched,st);changed=True;service("restart")
  for _ in range(16):
   try:
    stats=healthy(len(upstream["clips"]))
    if service("is-active")!="active":raise RuntimeError("relay_inactive_after")
    print("SECURITY_DRIVE_PERSON_RELAY_V22_VERIFIED",json.dumps({"already":False,"backup":str(backup),"service":"active","media_changed":False,**stats}),flush=True)
    return
   except Exception:time.sleep(1)
  raise RuntimeError("post_restart_validation_failed")
 except BaseException:
  if changed:
   try:put(original,st);service("restart");fetch(8794,"/new/api/saved");print("SECURITY_DRIVE_PERSON_RELAY_V22_ROLLED_BACK",flush=True)
   except Exception:print("SECURITY_DRIVE_PERSON_RELAY_V22_MANUAL_REPAIR_REQUIRED",flush=True)
  raise
if __name__=="__main__":main()
