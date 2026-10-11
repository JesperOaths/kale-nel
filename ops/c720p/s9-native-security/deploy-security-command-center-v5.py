#!/usr/bin/env python3
"""Transactionally install the Security V5 full-page HTML redesign on C720P.

Exactly four HTML paths; no APK, videos, face data, databases or camera service.
Dry-run by default. All target originals are copied before any modification.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime,timezone

WWW=Path("/opt/homeassistant/config/www")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/security-command-center-v5")
SCRIPTS=("patch-security-command-center-v5.py","patch-security-secondary-pages-v5.py")

TARGETS=(
 ("security","c720p-surveillance.html"),
 ("clips","frontyard-security-new/clips.html"),
 ("faces","frontyard-security-new/face-appearances.html"),
 ("archive","c720p-drive-saved.html"),
)
REQUIRED={
 "security":("s9v5-command-style","s9v5-command-script","s9v5-shell","data-tab="),
 "clips":("s9v5-browser-style","s9v5-browser-script","s9v5-browser","s9-compact-layout"),
 "faces":("s9v5-face-style",'id="gallery"','id="playerDialog"'),
 "archive":("s9v5-drive-style","C720PSecureRelay"),
}

def sha(content):return hashlib.sha256(content.encode("utf-8")).hexdigest()

def source(staging,file,alias):
 spec=importlib.util.spec_from_file_location(alias,staging/file)
 if not spec or not spec.loader:raise RuntimeError("cannot_load_"+file)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def build(root,staging):
 shell=source(staging,SCRIPTS[0],"v5_command")
 secondary=source(staging,SCRIPTS[1],"v5_secondary")
 patchers={"security":shell.patch_security,"clips":shell.patch_clips,
           "faces":secondary.face,"archive":secondary.archive}
 result={}
 for kind,path in TARGETS:
  target=root/path
  if not target.is_file() or target.is_symlink():raise RuntimeError("missing_or_unsafe_target_"+kind)
  old=target.read_text(encoding="utf-8")
  if len(old)<800 or len(old)>2_000_000:raise RuntimeError("invalid_html_size_"+kind)
  newer=patchers[kind](old)
  if patchers[kind](newer)!=newer:raise RuntimeError("patch_not_stable_"+kind)
  for required in REQUIRED[kind]:
   if required not in newer:raise RuntimeError("patch_output_missing_"+kind+"_"+required)
  if newer.count("</body>")!=old.count("</body>") or newer.count("</head>")!=old.count("</head>"):
   raise RuntimeError("unexpected_document_replacement_"+kind)
  if kind=="security":
   for required in ('id="panel-live"','id="panel-saved"','id="cameraLive"','cameraSavedFrame','s9SavedFolderFrame'):
    if required not in newer:raise RuntimeError("lost_existing_security_element_"+required)
  if kind=="clips":
   for required in ('id="player"','id="list"',"C720PSecureRelay","/new/saved/clip/"):
    if required not in newer:raise RuntimeError("lost_existing_clips_element_"+required)
  result[target]=(old,newer)
 return result

def deploy(updates,backup_root):
 changes={str(file):(old!=new) for file,(old,new) in updates.items()}
 if not any(changes.values()):return {"already_installed":True,"changes":changes}
 backup=backup_root/datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,exist_ok=False);os.chmod(backup,0o700)
 originals={}
 for i,(file,(old,new)) in enumerate(updates.items()):
  copy=backup/(str(i)+"-"+file.name)
  shutil.copy2(file,copy);os.chmod(copy,0o600)
  if copy.read_text(encoding="utf-8")!=old:raise RuntimeError("backup_validation_failed")
  originals[file]=copy
 updated=[]
 try:
  for file,(old,new) in updates.items():
   if old==new:continue
   descriptor,tmp=tempfile.mkstemp(prefix=".s9-v5-",suffix=".html",dir=file.parent)
   os.close(descriptor);staged=Path(tmp)
   try:
    staged.write_text(new,encoding="utf-8")
    st=file.stat();os.chmod(staged,st.st_mode & 0o777)
    try:os.chown(staged,st.st_uid,st.st_gid)
    except PermissionError:pass
    if staged.read_text(encoding="utf-8")!=new:raise RuntimeError("staging_verification_failed")
    os.replace(staged,file);updated.append(file)
   finally:staged.unlink(missing_ok=True)
  for file,(old,new) in updates.items():
   if file.read_text(encoding="utf-8")!=new:
    raise RuntimeError("post_install_verification_failed_"+file.name)
 except Exception:
  for file in reversed(updated):
   restore=file.with_name(".s9-v5-restore-"+file.name)
   shutil.copy2(originals[file],restore)
   os.replace(restore,file)
  raise
 return {"backup":str(backup),"changes":changes,
         "sha256":{str(file):sha(new) for file,(old,new) in updates.items()},
         "apk_modified":False,"recordings_modified":False}

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--root",type=Path,default=WWW)
 parser.add_argument("--staging",type=Path,default=Path(__file__).resolve().parent)
 parser.add_argument("--backup-root",type=Path,default=BACKUPS)
 parser.add_argument("--apply",action="store_true")
 opts=parser.parse_args()
 changes=build(opts.root.resolve(),opts.staging.resolve())
 if not opts.apply:
  print("S9_SECURITY_V5_DRY_RUN_OK",json.dumps({str(p):{"change":o!=n,"from":sha(o),"to":sha(n)}
         for p,(o,n) in changes.items()},sort_keys=True),flush=True);return
 result=deploy(changes,opts.backup_root)
 print("S9_SECURITY_V5_DEPLOYED",json.dumps(result,sort_keys=True),flush=True)
if __name__=="__main__":main()
