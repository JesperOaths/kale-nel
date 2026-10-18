#!/usr/bin/env python3
"""Checksum-pinned, reversible manual verified-source clip links in existing authenticated archive service.

The Samsung S9+ APK, original 4K recordings, camera services, microSD face
snapshots, and all existing human review state are strictly out of scope.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
WWW=Path("/opt/homeassistant/config/www/frontyard-security-new")
TARGETS={
 "backend":(HOME/"bin/s9_manual_recording_links.py",
    "ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py"),
 "proxy":(HOME/"bin/s9_sd_proxy_extension.py",
    "ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py")
}

BACK=HOME/"backups/s9-manual-links-v1"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"

def sha(data):return hashlib.sha256(data).hexdigest()

def fetch(url,limit):
 with urllib.request.urlopen(url,timeout=40) as r:
  if r.status!=200:raise RuntimeError("status_unavailable")
  data=r.read(limit+1)
 if not 1000<len(data)<=limit:raise RuntimeError("bounded_read_failed")
 return data

def api(path):
 with urllib.request.urlopen("http://127.0.0.1:8795"+path,timeout=16) as r:
  if r.status!=200:raise RuntimeError("archive_http_bad")
  data=r.read(4200001)
 if len(data)>4200000:raise RuntimeError("archive_metadata_too_large")
 return json.loads(data)

def write(path,data,owner):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,t=tempfile.mkstemp(prefix=".s9-manual-links-v1-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(t,stat.S_IMODE(owner.st_mode) if owner else 0o644)
  if owner:
   try:os.chown(t,owner.st_uid,owner.st_gid)
   except PermissionError:pass
  os.replace(t,path)
 finally:
  if os.path.exists(t):os.unlink(t)

def restart():
 p=subprocess.run(["systemctl","--user","restart",
    "c720p-drive-security-archive.service"],text=True,
    capture_output=True,timeout=70)
 if p.returncode:raise RuntimeError("archive_proxy_reload_failed")
 for _ in range(8):
  try:return api("/new/api/saved")
  except Exception:time.sleep(2)
 raise RuntimeError("archive_service_not_healthy")

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 for k in TARGETS:p.add_argument("--"+k+"-sha",required=True)
 args=p.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",args.ref):raise RuntimeError("immutable_ref_required")
 expected={k:getattr(args,k+"_sha") for k in TARGETS}
 if any(not re.fullmatch(r"[a-f0-9]{64}",h) for h in expected.values()):
  raise RuntimeError("checksums_required")
 before=api("/new/api/saved")
 if before.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_scope_changed")
 clips={e.get("clip_no") for e in before.get("events",[]) if isinstance(e,dict)}
 if not clips:raise RuntimeError("empty_archive_refuse_mutation")
 staged={}
 for k,(path,source) in TARGETS.items():
  if (k!="backend" and (not path.is_file() or path.is_symlink())) or path.is_symlink():
   raise RuntimeError("live_path_unexpected_"+k)
  body=fetch(URL+args.ref+"/"+source,130000)
  if sha(body)!=expected[k]:raise RuntimeError("source_hash_mismatch_"+k)
  required={"backend":b"manual_links_only",
    "proxy":b"s9_manual_recording_links.install(H,rows)"}[k]
  if required not in body:raise RuntimeError("source_contract_missing_"+k)
  compile(body,source,"exec")
  staged[path]=body
 backup_originals={path:(path.read_bytes() if path.is_file() else None,
    path.stat() if path.is_file() else None) for path in staged}
 if all(data==backup_originals[path][0] for path,data in staged.items()):
  links=api("/new/api/s9-manual-recording-links")
  if links.get("ok") is not True or links.get("manual_links_only") is not True:
   raise RuntimeError("already_installed_but_manual_link_route_missing")
  print("S9_MANUAL_CLIP_LINKS_DEPLOY_VERIFIED "+json.dumps({
   "already":True,"originals":len(clips),"backend_mutation":False,
   "camera_modified":False,"manual_link_route_active":True}),flush=True)
  return
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder=BACK/stamp
 folder.mkdir(mode=0o700)
 for k,(target,_) in TARGETS.items():
  old=backup_originals[target][0]
  if old is None:continue
  saved=folder/(k+"-"+target.name)
  with saved.open("xb") as f:
   f.write(old);f.flush();os.fsync(f.fileno())
  os.chmod(saved,0o600)
  if saved.read_bytes()!=old:raise RuntimeError("rollback_backup_corrupt")
 if any((p.read_bytes() if p.is_file() else None)!=prior[0]
        for p,prior in backup_originals.items()):
  raise RuntimeError("concurrent_archive_code_change")
 changed=[]
 try:
  for path,data in staged.items():
   if data==backup_originals[path][0]:continue
   write(path,data,backup_originals[path][1]);changed.append(path)
  response=restart()
  # Collision check: never claim successful deployment if the live loader
  # still routes this endpoint to the old visual-review handler.
  drive_catalog=api("/new/api/drive-saved")
  if (drive_catalog.get("ok") is not True or
      drive_catalog.get("archive_mode")=="S9-microSD-only" or
      not isinstance(drive_catalog.get("events"),list) or
      len(drive_catalog["events"])<100):
   raise RuntimeError("historical_drive_catalog_missing_after_proxy_restart")
  direct=api("/new/api/s9-manual-recording-links")
  if direct.get("manual_links_only") is not True or direct.get("automatic_identity_matching") is not False:
   raise RuntimeError("manual_api_wrong_live_handler")
  after={e.get("clip_no") for e in response.get("events",[]) if isinstance(e,dict)}
  if response.get("archive_mode")!="S9-microSD-only" or not clips.issubset(after):
   raise RuntimeError("existing_recordings_disappeared")
  links=api("/new/api/s9-manual-recording-links")
  if links.get("ok") is not True or links.get("manual_links_only") is not True or links.get("automatic_identity_matching") is not False:
   raise RuntimeError("private_manual_link_route_not_verified")
  print("S9_MANUAL_CLIP_LINKS_DEPLOY_VERIFIED "+json.dumps({
   "already":False,"originals":len(after),"manual_link_route_active":True,
   "backup":str(folder),"ref":args.ref,
   "camera_modified":False,"recordings_modified":False,
   "face_models_modified":False,"biometric_identity_enabled":False,
   "existing_link_state_preserved":True}),flush=True)
 except BaseException:
  for target in reversed(changed):
   old,owner=backup_originals[target]
   try:
    if old is None:target.unlink(missing_ok=True)
    else:write(target,old,owner)
   except Exception:print("S9_STEP2_CLIP_LINKS_MANUAL_RESTORE_REQUIRED "+target.name,flush=True)
  try:restart()
  except Exception:print("S9_STEP2_CLIP_LINKS_PROXY_RELOAD_REQUIRED",flush=True)
  print("S9_MANUAL_CLIP_LINKS_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":main()
