#!/usr/bin/env python3
"""Fail-closed, C720P-only installation of already-tested Automatic Person review finality.

Update only the private API's Python module from the exact pre-#925 source to
the #925-or-newer pinned commit. Never touch Camera2, 4K files, face vectors,
manual approvals, denials, proxy bindings, or the S9+ phone.
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

ROOT=Path("/home/jespern/c720p-home-hub")
MODULE=ROOT/"bin/s9_automatic_person_review.py"
PROXY=ROOT/"bin/s9_sd_proxy_extension.py"
BACK=ROOT/"backups/security-auto-person-finality-v110"
SERVICE="c720p-drive-security-archive.service"
OLD_REF="b3a1142bdc708d5871bfe794893c1df498fc34c5"
SOURCE="ops/c720p/s9-person-ml-v1/s9_automatic_person_review.py"
ASSETS=(
 "s9-manual-recording-links-v1.json",
 "s9-manual-recording-links-v1.audit.jsonl",
 "s9-auto-person-rejections-v1.json",
 "s9-auto-person-rejections-v1.audit.jsonl",
)
def sha(raw):return hashlib.sha256(raw).hexdigest()

def fetch(ref):
 if not re.fullmatch(r"[0-9a-f]{40}",ref):raise RuntimeError("invalid_ref")
 url="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+ref+"/"+SOURCE
 req=urllib.request.Request(url,headers={"User-Agent":"S9-private-review-v110"})
 with urllib.request.urlopen(req,timeout=35) as response:raw=response.read(25001)
 if not 3000<len(raw)<=25000:raise RuntimeError("unexpected_remote_source")
 compile(raw.decode("utf-8"),SOURCE,"exec")
 return raw

def snapshots():
 results={}
 for name in ASSETS:
  p=ROOT/"state"/name
  if p.is_symlink():raise RuntimeError("unsafe_review_registry")
  results[name]=sha(p.read_bytes()) if p.is_file() else None
 return results

def api():
 req=urllib.request.Request("http://127.0.0.1:8795/new/api/automatic-person",
   headers={"Cache-Control":"no-store"})
 with urllib.request.urlopen(req,timeout=12) as response:
  if response.status!=200:raise RuntimeError("automatic_person_http_unhealthy")
  doc=json.loads(response.read(1500001))
 if (doc.get("ok") is not True or
     doc.get("human_approval_required") is not True or
     doc.get("automatic_assignments") is not False or
     doc.get("face_vectors_exported") is not False or
     not isinstance(doc.get("items"),list)):
  raise RuntimeError("automatic_person_contract_unhealthy")
 return doc.get("status","unknown")

def service(action):
 proc=subprocess.run(["systemctl","--user",action,SERVICE],
   capture_output=True,text=True,timeout=45)
 if proc.returncode:raise RuntimeError("metadata_service_"+action+"_failed")

def atomic(path,raw,old_stat):
 fd,tmp=tempfile.mkstemp(prefix=".auto-person-v110-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:
   out.write(raw);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(old_stat.st_mode))
  try:os.chown(tmp,old_stat.st_uid,old_stat.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def check_api():
 for attempt in range(20):
  try:return api()
  except (OSError,ValueError,RuntimeError):
   if attempt==19:raise
   time.sleep(1)

def main():
 args=argparse.ArgumentParser()
 args.add_argument("--apply",action="store_true")
 a=args.parse_args()
 target=os.environ.get("S9_SECURITY_REF","")
 digest=os.environ.get("S9_AUTO_PERSON_NEW_SHA256","")
 if not re.fullmatch("[0-9a-f]{40}",target) or not re.fullmatch("[0-9a-f]{64}",digest):
  raise RuntimeError("pinned_target_required")
 if any(not p.is_file() or p.is_symlink() for p in (PROXY,MODULE)):
  raise RuntimeError("missing_or_unsafe_live_backend")
 if PROXY.read_text().count("s9_automatic_person_review.install(H,rows)")!=1:
  raise RuntimeError("unexpected_private_api_hook")
 service("is-active")
 before=MODULE.read_bytes();mode=MODULE.stat()
 initial=fetch(OLD_REF);desired=fetch(target)
 if sha(desired)!=digest or b"def final_manual_decision" not in desired or b"denied_pairs" not in desired:
  raise RuntimeError("target_version_or_sha_mismatch")
 if before not in (initial,desired):
  # A newer live release may already exist. Do not roll it back.
  print("S9_AUTO_PERSON_V110_DEFERRED_NEWER_BACKEND "+
        json.dumps({"live_sha256":sha(before),"expected_old_sha256":sha(initial),
          "requested_sha256":sha(desired),"modified":False}),flush=True)
  return
 review_before=snapshots()
 current_status=check_api()
 if before==desired:
  if snapshots()!=review_before:raise RuntimeError("concurrent_review_change")
  print("S9_AUTO_PERSON_V110_VERIFIED "+
        json.dumps({"already":True,"status":current_status,
          "module_sha256":sha(desired),"originals_modified":False,
          "manual_reviews_modified":False,"camera_apk_modified":False}),flush=True)
  return
 print("S9_AUTO_PERSON_V110_PREFLIGHT "+
       json.dumps({"old_sha256":sha(before),"target_sha256":sha(desired),
         "safe_source":True,"apply":a.apply,"camera_apk_modified":False}),flush=True)
 if not a.apply:return
 if ROOT.stat().st_dev!=MODULE.stat().st_dev:raise RuntimeError("unexpected_module_mount")
 if os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize<24*1024*1024:
  raise RuntimeError("low_backup_disk")
 backup=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 oldpath=backup/"module-before.py"
 with oldpath.open("xb") as f:
  f.write(before);f.flush();os.fsync(f.fileno())
 os.chmod(oldpath,0o600)
 changed=False
 try:
  if MODULE.read_bytes()!=before or snapshots()!=review_before:
   raise RuntimeError("live_backend_or_review_changed_during_preflight")
  atomic(MODULE,desired,mode);changed=True
  service("restart")
  after_status=check_api()
  if (MODULE.read_bytes()!=desired or snapshots()!=review_before or
      PROXY.read_text().count("s9_automatic_person_review.install(H,rows)")!=1):
   raise RuntimeError("post_install_integrity_check_failed")
  print("S9_AUTO_PERSON_V110_VERIFIED "+
        json.dumps({"already":False,"status":after_status,
          "module_sha256":sha(desired),"backup":str(backup),
          "originals_modified":False,"manual_reviews_modified":False,
          "camera_apk_modified":False}),flush=True)
 except BaseException:
  if changed:
   atomic(MODULE,before,mode)
   service("restart")
   if MODULE.read_bytes()!=before:raise RuntimeError("restore_integrity_failed")
  print("S9_AUTO_PERSON_V110_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":main()
