#!/usr/bin/env python3
"""Guarded C720P Drive archive thumbnail fix.

The original card() constructs an image in a detached DOM subtree.
drivePreview() immediately calls fetchPreview(), which aborts on
!img.isConnected before any URL request is started. Wait one animation frame
so the containing card has been attached, preserving lazy images and retry.
Only changes that specific call site. Backup + atomic replace + exact diff.
"""
from __future__ import annotations
import hashlib,json,os,pathlib,re,sys,datetime,subprocess,urllib.request,shutil
PATH=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/security-archive-v7.html")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/drive-thumbnails-dom-v1")
MARKER=b"DRIVE_PREVIEW_DOM_ATTACH_FIX_V1"
ORIGINAL=b" img.onerror=()=>{img.removeAttribute('src');schedule()};"
OLD=b" fetchPreview();"
NEW=b" // DRIVE_PREVIEW_DOM_ATTACH_FIX_V1: wait for card insertion before checking isConnected.\n requestAnimationFrame(fetchPreview);"
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 if not PATH.is_file() or PATH.is_symlink():raise RuntimeError("missing_frontend_asset")
 old=PATH.read_bytes()
 if MARKER in old:
  print(json.dumps({"already_installed":True,"sha256":sha(old)}));return 0
 if old.count(ORIGINAL)!=1:raise RuntimeError("unexpected_frontend_handler")
 sep=b"\r\n" if b"\r\n" in old else b"\n"
 anchor=ORIGINAL+sep+OLD
 if old.count(anchor)!=1:raise RuntimeError("ambiguous_detached_element_bug_anchor")
 if b"const fetchPreview=async()=>{" not in old or b"if(!img.isConnected||img.dataset.drivePreviewReady==='1')return;" not in old:
  raise RuntimeError("original_thumbnail_guard_missing")
 replacement=ORIGINAL+sep+NEW.replace(b"\n",sep)
 newer=old.replace(anchor,replacement,1)
 if len(newer)<=len(old):raise RuntimeError("replacement_failed")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/(stamp+".html")
 if backup.exists():raise RuntimeError("backup_collision")
 fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,"wb") as f:f.write(old);f.flush();os.fsync(f.fileno())
 temp=PATH.with_name(".security-archive-v7.html.drive-thumb-v1.tmp")
 try:
  with temp.open("wb") as f:f.write(newer);f.flush();os.fsync(f.fileno())
  os.chmod(temp,PATH.stat().st_mode&0o777)
  os.replace(temp,PATH)
  deployed=PATH.read_bytes()
  if deployed!=newer:raise RuntimeError("frontend_readback_mismatch")
  if deployed.count(MARKER)!=1:raise RuntimeError("marker_missing")
  # Served through Home Assistant /local path; verify actual new assets.
  req=urllib.request.Request("http://127.0.0.1:8123/local/frontyard-security-new/security-archive-v7.html?drive_thumbs="+stamp,method="GET")
  try:
   with urllib.request.urlopen(req,timeout=12) as response:
    served=response.read(260000)
    if response.status!=200 or MARKER not in served:
     raise RuntimeError("home_assistant_asset_not_updated")
   http=True
  except Exception:
   # HA token/session policies can deny localhost requests; leave file as
   # source of truth without claiming the web transport has been verified.
   http=False
  receipt={"version":"DRIVE_PREVIEW_DOM_ATTACH_FIX_V1","at":stamp,
           "original_sha256":sha(old),"deployed_sha256":sha(newer),
           "backup":str(backup),"asset":str(PATH),
           "only_drive_preview_handler_modified":True,
           "home_assistant_asset_http_verified":http}
  out=BACK/(stamp+".json")
  out.write_text(json.dumps(receipt,indent=2))
  print(json.dumps(receipt,sort_keys=True))
  return 0
 except Exception:
  PATH.write_bytes(old)
  raise
 finally:
  if temp.exists():temp.unlink()
if __name__=="__main__":sys.exit(main())
