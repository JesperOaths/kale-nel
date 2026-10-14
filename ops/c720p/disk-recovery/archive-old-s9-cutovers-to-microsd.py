#!/usr/bin/env python3
"""Move obsolete C720P S9 cutover snapshots to SD after end-to-end SHA proof.

Protect installed versions + recent rollback APKs on C720P. Only the obsolete
unreferenced native-security-cutover folder (last touched 2026-10-12) is
eligible. Keep recovery index, original paths, hashes and restore instructions.
"""
import datetime,hashlib,json,os,pathlib,re,shutil,subprocess,tarfile,tempfile,urllib.request
HOME=pathlib.Path("/home/jespern/c720p-home-hub")
SRC=HOME/"backups/native-security-cutover"
REPORTS=HOME/"reports"
PHONE="192.168.178.250:5555"
PHONE_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Archives"
ARCHIVE="c720p-native-security-cutover-20261014.tar"
PROTECT=[
 HOME/"build/s9-face-roi-movement-v2/s9-face-roi-movement-v2.apk",
 HOME/"build/s9-face-roi-movement-v1/s9-face-roi-movement-v1.apk",
 HOME/"backups/s9-face-roi-movement-v2/before-face-roi-v2-20261014T050544Z.apk",
 HOME/"backups/s9-face-roi-movement-v1/before-face-roi-20261014T040629Z.apk"]
def digest(p):
 h=hashlib.sha256()
 with open(p,"rb") as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def run(args,timeout=60):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed_"+str(args[:5])+" "+p.stderr[-350:])
 return p.stdout.strip()
def adb(*args,timeout=75):return run(["adb","-s",PHONE,*args],timeout=timeout)
def state():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:
  o=json.load(r)
 if not o.get("ok") or o.get("mode")!="watching" or not o.get("native_4k_enabled") or not o.get("preroll_ready"):
  raise RuntimeError("camera_not_healthy")
 if float(o.get("temperature_c",100))>=39:raise RuntimeError("camera_too_warm")
 if int(o.get("sd_free_bytes",0))<10*1024**3:raise RuntimeError("microSD_insufficient_space")
 return o
def main():
 if not SRC.is_dir() or SRC.is_symlink():raise RuntimeError("obsolete_cutover_not_found")
 pres={str(p):digest(p) for p in PROTECT if p.is_file() and not p.is_symlink()}
 if len(pres)!=len(PROTECT):raise RuntimeError("protected_rollback_missing")
 files=sorted(p for p in SRC.rglob("*") if p.is_file())
 if not 20<=len(files)<=70 or any(p.is_symlink() for p in SRC.rglob("*")):
  raise RuntimeError("unexpected_legacy_backup_tree")
 if any(not p.suffix.lower() in (".apk",".json",".txt",".sha256") for p in files):
  raise RuntimeError("unexpected_file_type_abort")
 if max(p.stat().st_mtime for p in files)>1791936000:  # 2026-10-14 00:00 UTC
  raise RuntimeError("cutover_tree_recently_modified")
 before=state()
 plan=[dict(path=str(p.relative_to(SRC)),size=p.stat().st_size,sha256=digest(p)) for p in files]
 folder_count=sum(1 for p in SRC.rglob("*") if p.is_dir())
 fs_before=os.statvfs("/")
 tmp=pathlib.Path(tempfile.gettempdir())/(".c720p-s9-cutover-offload-"+str(os.getpid())+".tar")
 remote=PHONE_ROOT+"/"+ARCHIVE
 try:
  with tarfile.open(tmp,"w") as out:out.add(SRC,arcname=SRC.name,recursive=True)
  with tarfile.open(tmp,"r") as check:
   members=check.getmembers()
   names={m.name for m in members if m.isfile() or m.islnk()}
   expected={str(pathlib.PurePosixPath(SRC.name,x["path"])) for x in plan}
   if names!=expected:raise RuntimeError("tar_path_manifest_mismatch")
   if any(m.name.startswith("/") or ".." in pathlib.PurePosixPath(m.name).parts for m in members):
    raise RuntimeError("unsafe_archive_member")
  sha=digest(tmp)
  adb("shell","mkdir","-p",PHONE_ROOT,timeout=25)
  adb("push",str(tmp),remote+".partial",timeout=420)
  remote_sha=adb("shell","sha256sum",remote+".partial",timeout=115).split()[0]
  if remote_sha.lower()!=sha:raise RuntimeError("phone_sd_checksum_mismatch")
  adb("shell","mv",remote+".partial",remote,timeout=30)
  remote_sha=adb("shell","sha256sum",remote,timeout=115).split()[0]
  if remote_sha.lower()!=sha:raise RuntimeError("phone_sd_final_checksum_mismatch")
  if state().get("mode")!="watching":raise RuntimeError("camera_state_did_not_survive_transfer")
  if any(p.stat().st_size!=x["size"] or digest(p)!=x["sha256"] for p,x in zip(files,plan)):
   raise RuntimeError("original_backup_tree_modified")
  REPORTS.mkdir(parents=True,exist_ok=True)
  receipt=REPORTS/"c720p-s9-old-cutovers-sd-archive-20261014.json"
  if receipt.exists():raise RuntimeError("receipt_already_exists")
  data=dict(remote=remote,sha256=sha,archive_bytes=tmp.stat().st_size,
    file_count=len(plan),directories=folder_count,files=plan,
    restore_hint="adb -s "+PHONE+" pull "+remote+" /tmp/"+ARCHIVE+
      " ; tar -xf /tmp/"+ARCHIVE+" -C "+str(SRC.parent),
    original_apk_paths_on_hub_removed=True,
    critical_v1_v2_rollback_locally_preserved=True)
  fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,"w") as out:
   json.dump(data,out,indent=2);out.flush();os.fsync(out.fileno())
  shutil.rmtree(SRC)
  if any(digest(pathlib.Path(p))!=v for p,v in pres.items()):
   raise RuntimeError("protected_release_modified_after_cleanup")
  fs_after=os.statvfs("/")
  print("SD_ARCHIVE_VERIFIED_AND_LOCAL_OLD_CUTOVERS_REMOVED",json.dumps({
    "remote_archive":remote,"sha256":sha,"archive_mib":round(tmp.stat().st_size/1048576,2),
    "source_files_archived":len(plan),"freed_root_mib":round(
      (fs_after.f_bavail-fs_before.f_bavail)*fs_after.f_frsize/1048576,2),
    "current_rollback_versions_preserved":len(pres),
    "receipt":str(receipt)}),flush=True)
 finally:
  if tmp.exists():tmp.unlink()
if __name__=="__main__":main()
