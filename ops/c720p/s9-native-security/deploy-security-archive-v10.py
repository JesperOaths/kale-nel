#!/usr/bin/env python3
"""Install the native dual-source Archive V10; preserve Drive and microSD media.

Only Archive HTML and its embedding URL in the Home Assistant Security shell
are replaced. Immutable GitHub SHA-256 source and on-device readback required.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

WWW=Path("/opt/homeassistant/config/www")
ARCHIVE=WWW/"frontyard-security-new/security-archive-v7.html"
ROOT=WWW/"c720p-surveillance.html"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-archive-v10")
REPO="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
TEMPLATE="ops/c720p/s9-native-security/security-archive-v7.html"
OLD_URL="/local/frontyard-security-new/security-archive-v7.html?v=drive-archive-v9"
NEW_URL="/local/frontyard-security-new/security-archive-v7.html?v=drive-archive-v10"
ROUTES=["/new/api/drive-saved","/new/api/saved"]
LOCAL="http://127.0.0.1:8795"

def sha(data):return hashlib.sha256(data).hexdigest()

def http(url,size=100000,timeout=20):
 with urllib.request.urlopen(url,timeout=timeout) as r:
  if r.status!=200:raise RuntimeError("bad_http_status")
  data=r.read(size+1)
 if len(data)>size:raise RuntimeError("response_too_large")
 return data

def catalog(path):
 doc=json.loads(http(LOCAL+path,2_000_000,55))
 if doc.get("ok") is not True or not isinstance(doc.get("events"),list):
  raise RuntimeError("archive_catalog_invalid_"+path)
 return doc

def baseline():
 sd=catalog("/new/api/saved")
 drive=catalog("/new/api/drive-saved")
 if sd.get("archive_mode")!="S9-microSD-only" or drive.get("archive_mode")=="S9-microSD-only":
  raise RuntimeError("archive_sources_not_separate")
 if not drive["events"]:raise RuntimeError("historical_drive_archive_empty")
 return (len(sd["events"]),len(drive["events"]))

def atomic(path,data,metadata):
 fd,tmp=tempfile.mkstemp(prefix=".archive-v10-",suffix=".html",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(metadata.st_mode))
  try:os.chown(tmp,metadata.st_uid,metadata.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def check_page(s):
 for key in ("id=\"driveTimeline\"","id=\"localLibrary\"",
             "id=\"driveMonthSelect\"","id=\"driveRefresh\"",
             "a.fetch('/new/api/drive-saved'","a.fetch('/new/api/saved'",
             "a.url('/new/drive/saved/clip/'",
             "a.url('/new/saved/clip/'","showSource('drive');"):
  if key not in s:raise RuntimeError("archive_source_contract_missing")
 if 'id="driveArchiveFrame"' in s or "c720p-drive-saved.html" in s:
  raise RuntimeError("nested_drive_browser_not_removed")
 if s.count("</body>")!=1 or s.count("</head>")!=1:
  raise RuntimeError("invalid_archive_document")

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 p.add_argument("--sha256",required=True)
 args=p.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",args.ref) or not re.fullmatch("[a-f0-9]{64}",args.sha256):
  raise RuntimeError("invalid_source_pin")
 for file in (ARCHIVE,ROOT):
  if file.is_symlink() or not file.is_file():raise RuntimeError("expected_live_page_missing")
 old={file:file.read_bytes() for file in (ARCHIVE,ROOT)}
 modes={file:file.stat() for file in (ARCHIVE,ROOT)}
 root=old[ROOT].decode("utf-8")
 before=baseline()
 template=http(REPO+args.ref+"/"+TEMPLATE,100000,30)
 if sha(template)!=args.sha256:raise RuntimeError("immutable_template_digest_mismatch")
 check_page(template.decode("utf-8"))
 if NEW_URL in root and OLD_URL not in root and old[ARCHIVE]==template:
  print("ARCHIVE_V10_ALREADY_INSTALLED "+json.dumps({"source":"drive_and_microSD","sd":before[0],"drive":before[1]}),flush=True)
  return
 if root.count(OLD_URL)!=1 or NEW_URL in root:
  raise RuntimeError("unexpected_security_shell_archive_route")
 newer=root.replace(OLD_URL,NEW_URL,1)
 newer=newer.replace("SECURITY V7</div>","SECURITY V10 · ARCHIVE</div>",1)
 update={ARCHIVE:template,ROOT:newer.encode("utf-8")}
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 folder=BACKUP/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 for file in (ARCHIVE,ROOT):
  b=folder/file.name
  b.write_bytes(old[file])
  os.chmod(b,0o600)
  if b.read_bytes()!=old[file]:raise RuntimeError("archive_rollback_backup_invalid")
 changed=[]
 try:
  for file in (ARCHIVE,ROOT):
   atomic(file,update[file],modes[file]);changed.append(file)
  for file in (ARCHIVE,ROOT):
   rel=file.relative_to(WWW).as_posix()
   published=http("http://127.0.0.1:8123/local/"+rel+"?v=security-archive-v10",2_000_000,20)
   if sha(published)!=sha(update[file]):raise RuntimeError("published_document_hash_mismatch_"+file.name)
  after=baseline()
  if after[0]<before[0] or after[1]<before[1]:
   raise RuntimeError("recording_catalog_lost_rows")
  print("ARCHIVE_V10_DEVICE_VERIFIED "+json.dumps({
   "drive_clips":after[1],"microSD_clips":after[0],"date_grouped_drive":True,
   "native_archive_browser":True,"backup":str(folder),
   "http_pages_verified":2,"camera_changed":False,"media_changed":False,
   "template_sha256":args.sha256
  }),flush=True)
 except BaseException as exc:
  for file in reversed(changed):
   try:atomic(file,old[file],modes[file])
   except Exception as rollback_error:
    print("ARCHIVE_V10_RESTORE_ERROR",file.name,type(rollback_error).__name__,flush=True)
  print("ARCHIVE_V10_ROLLED_BACK",type(exc).__name__,str(exc)[:200],flush=True)
  raise

if __name__=="__main__":main()
