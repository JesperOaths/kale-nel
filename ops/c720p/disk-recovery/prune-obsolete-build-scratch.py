#!/usr/bin/env python3
"""Prune rebuildable Android staging scratch and abandoned Chromium temp profiles.

Fail-closed, exact allowed paths, no recordings/rollback/signed APKs, no live
person detector or benchmark virtual environment, and no active browser profile.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,shutil,subprocess,stat,time
ROOT=Path("/home/jespern/c720p-home-hub")
BASE=ROOT/"build"
SIGNED=[
 BASE/"s9-face-roi-movement-v2/s9-face-roi-movement-v2.apk",
 BASE/"s9-face-roi-movement-v1/s9-face-roi-movement-v1.apk",
 BASE/"s9-onphone-prepended-mp4-v1c/s9-prepended-v1c.apk",
 BASE/"s9-native-security/s9-native-security.apk",
 BASE/"s9-person-ml-v1/s9-person-v1.apk"]
OLD=["s9-native-security","s9-person-ml-v1"]
PARTS=["classes","dex","pkg","assets"]
EXTRAS=[BASE/"s9-person-ml-v1/deps", BASE/"s9-person-ml-v1/s9-person-unsigned.apk"]
HEADLESS=Path("/home/jespern/.config/chromium-headless")
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bytes_used(p):
 if p.is_file():return p.stat().st_blocks*512
 return sum(f.stat().st_blocks*512 for f in p.rglob("*") if f.is_file() and not f.is_symlink())
def proc_commands():
 p=subprocess.run(["ps","-eo","args"],text=True,capture_output=True,timeout=15,check=True)
 return p.stdout
def main():
 a=argparse.ArgumentParser();a.add_argument("--apply",action="store_true")
 opt=a.parse_args()
 saved={}
 for p in SIGNED:
  if not p.is_file() or p.is_symlink() or p.stat().st_size<3000000:
   raise RuntimeError("missing_or_bad_signed_apk_"+str(p))
  saved[str(p)]=digest(p)
 if not BASE.is_dir() or BASE.is_symlink():raise RuntimeError("invalid_build_root")
 procs=proc_commands()
 units=subprocess.run(["grep","-R","-E","build/s9-(native-security|person-ml-v1)/(classes|dex|pkg|assets|deps)","/home/jespern/.config/systemd/user"],capture_output=True,text=True)
 if units.returncode==0:raise RuntimeError("service_references_legacy_android_staging")
 targets=[]
 for name in OLD:
  folder=BASE/name
  if not folder.is_dir() or folder.is_symlink():raise RuntimeError("staging_folder_invalid")
  for sub in PARTS:
   candidate=folder/sub
   if candidate.exists() and candidate.is_dir() and not candidate.is_symlink():
    targets.append(candidate)
 for p in EXTRAS:
  if p.exists() and not p.is_symlink() and (p.is_dir() or p.is_file()):
   targets.append(p)
 if HEADLESS.is_dir() and not HEADLESS.is_symlink():
  for p in HEADLESS.iterdir():
   if not p.name.startswith("scoped_dir") or not p.is_dir() or p.is_symlink():continue
   if p.name in procs or time.time()-p.stat().st_mtime<48*3600:continue
   targets.append(p)
 data=[{"path":str(p),"bytes":bytes_used(p)} for p in targets]
 print("SCRATCH_CLEANUP_PLAN",json.dumps({
   "count":len(targets),"rebuildable_mib":round(sum(x["bytes"] for x in data)/1048576,2),
   "targets":data},sort_keys=True),flush=True)
 if not opt.apply:return
 fs=os.statvfs("/")
 for p in targets:
  if p.is_dir():shutil.rmtree(p)
  else:p.unlink()
 for p,prior in saved.items():
  if digest(Path(p))!=prior:raise RuntimeError("signed_apk_modified_during_cleanup")
 fs2=os.statvfs("/")
 report={"removed_items":len(targets),
         "freed_mib":round((fs2.f_bavail-fs.f_bavail)*fs2.f_frsize/1048576,2),
         "signed_apks_hash_verified":len(SIGNED),"removed":data}
 out=ROOT/"reports"/("s9-staging-cleanup-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".json")
 out.write_text(json.dumps(report,indent=2))
 out.chmod(0o600)
 print("SCRATCH_CLEANUP_APPLIED",json.dumps({"freed_mib":report["freed_mib"],
   "removed_items":len(targets),"receipt":str(out),"signed_apks_intact":True}),flush=True)
if __name__=="__main__":main()
