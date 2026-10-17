#!/usr/bin/env python3
"""Checksum-pinned, reversible Step 2 case UI + private archive route release.

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
 "backend":(HOME/"bin/s9_manual_evidence_cases.py",
    "ops/c720p/s9-person-ml-v1/s9_manual_evidence_cases.py"),
 "proxy":(HOME/"bin/s9_sd_proxy_extension.py",
    "ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py"),
 "ui":(WWW/"security-face-folders-v22.html",
    "ops/c720p/s9-native-security/security-face-folders-v22.html")
}
BACK=HOME/"backups/s9-step2-human-cases-v1"
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
 fd,t=tempfile.mkstemp(prefix=".s9-cases-v1-",dir=path.parent)
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
  required={"backend":b"manual_collection_only",
    "proxy":b"s9_manual_evidence_cases.install(H)",
    "ui":b'id="casesTab"'}[k]
  if required not in body:raise RuntimeError("source_contract_missing_"+k)
  if k!="ui":compile(body,source,"exec")
  else:
   for part in (b"X-S9-Case-Intent",b"casePicker",b"reviewToCase",b"C720PSecureRelay"):
    if part not in body:raise RuntimeError("ui_case_contract_missing")
  staged[path]=body
 backup_originals={path:(path.read_bytes() if path.is_file() else None,
    path.stat() if path.is_file() else None) for path in staged}
 if all(data==backup_originals[path][0] for path,data in staged.items()):
  cases=api("/new/api/s9-evidence-cases")
  if cases.get("ok") is not True or cases.get("manual_collection_only") is not True:
   raise RuntimeError("already_installed_but_case_route_missing")
  print("S9_STEP2_PERSISTENT_CASES_DEPLOY_VERIFIED "+json.dumps({
   "already":True,"originals":len(clips),"backend_mutation":False,
   "camera_modified":False,"case_route_active":True}),flush=True)
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
  after={e.get("clip_no") for e in response.get("events",[]) if isinstance(e,dict)}
  if response.get("archive_mode")!="S9-microSD-only" or not clips.issubset(after):
   raise RuntimeError("existing_recordings_disappeared")
  cases=api("/new/api/s9-evidence-cases")
  if cases.get("ok") is not True or cases.get("manual_collection_only") is not True or cases.get("auto_identity") is not False:
   raise RuntimeError("private_case_route_not_verified")
  web=fetch("http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html?cases="+args.ref[:12],130000)
  if sha(web)!=expected["ui"]:raise RuntimeError("homeassistant_ui_hash_mismatch")
  print("S9_STEP2_PERSISTENT_CASES_DEPLOY_VERIFIED "+json.dumps({
   "already":False,"originals":len(after),"case_route_active":True,
   "ui_http_verified":True,"backup":str(folder),"ref":args.ref,
   "camera_modified":False,"recordings_modified":False,
   "face_models_modified":False,"biometric_identity_enabled":False,
   "existing_case_state_preserved":True}),flush=True)
 except BaseException:
  for target in reversed(changed):
   old,owner=backup_originals[target]
   try:
    if old is None:target.unlink(missing_ok=True)
    else:write(target,old,owner)
   except Exception:print("S9_STEP2_CASES_MANUAL_RESTORE_REQUIRED "+target.name,flush=True)
  try:restart()
  except Exception:print("S9_STEP2_CASES_PROXY_RELOAD_REQUIRED",flush=True)
  print("S9_STEP2_PERSISTENT_CASES_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":main()
