#!/usr/bin/env python3
"""Archive ONLY two redundant V26 build copies to S9+ microSD with hashes.

The old signed APK remains in the protected hub rollback directory. The V26
camera continues recording and is never installed/stopped/reset by this task.
"""
import hashlib,json,os,pathlib,subprocess,time,shutil,urllib.request
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
BUILD=ROOT/"build/s9-face-recall-v26"
BACK=ROOT/"backups/s9-face-recall-v26"
REMOTE="/storage/9C33-6BBD/c720p-offloaded-build-evidence-20261014/v26-build-copies"
REPORT=ROOT/"reports/s9-v26-redundant-build-offload.jsonl"
SERIAL="192.168.178.250:5555"
PKG="nl.kalenel.s9security"
EXPECTED_V26="e0c2e8726944c737c3e2a6afaa70a897d4bf6504c85de9412d801845227252c5"
def adb(*args,timeout=45):
 p=subprocess.run(["adb","-s",SERIAL,*args],capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("adb_operation_failed")
 return p.stdout.strip()
def digest(f):
 h=hashlib.sha256()
 with f.open("rb") as i:
  for chunk in iter(lambda:i.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def healthy():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:d=json.load(r)
 if not(d.get("ok") is True and d.get("mode")=="watching" and
   d.get("native_4k_enabled") is True and
   d.get("garden_person_gate_backend")=="gpu" and
   d.get("continuous_4k_ready") is True and
   d.get("temperature_c",99)<39 and
   d.get("last_frame_age_ms",99999)<3000):
  raise RuntimeError("S9_native_4k_gpu_not_healthy")
 return d
def safe(f):
 if f.parent!=BUILD or f.is_symlink() or not f.is_file():return False
 st=f.stat()
 return st.st_nlink==1 and 9000000<st.st_size<35000000
def proc_uses(path):
 for proc in pathlib.Path("/proc").iterdir():
  if not proc.name.isdigit():continue
  for p in (proc/"cwd",proc/"exe"):
   try:
    if p.resolve()==path:return True
   except(OSError,PermissionError):pass
  try:
   for fd in (proc/"fd").iterdir():
    try:
     if fd.resolve()==path:return True
    except(OSError,PermissionError):pass
  except(OSError,PermissionError):pass
 return False
def remote_exists(path):
 p=subprocess.run(["adb","-s",SERIAL,"shell","test","-f",path],
                  capture_output=True,timeout=15)
 return p.returncode==0
def main():
 before=shutil.disk_usage("/").free
 status=healthy()
 if adb("shell","getprop","ro.product.model")!="SM-G965F":raise RuntimeError("phone_not_S9plus")
 installed=[x.split(":",1)[1] for x in adb("shell","pm","path",PKG).splitlines()
   if x.startswith("package:") and x.endswith("base.apk")]
 if len(installed)!=1:raise RuntimeError("installed_package_ambiguous")
 installed_sha=adb("shell","sha256sum",installed[0]).split()[0]
 if installed_sha!=EXPECTED_V26:raise RuntimeError("V26_no_longer_current_refuse_offload")
 release=json.loads((BUILD/"release.json").read_text())
 if release.get("sha256")!=EXPECTED_V26 or release.get("source_sha")!="edb63c841d23d23163666d3bd6df1ed4c36d79df":
  raise RuntimeError("release_provenance_unexpected")
 previous=(BUILD/"installed-before-v26.apk")
 current=(BUILD/"s9-face-recall-v26.apk")
 protected=sorted(BACK.glob("installed-before-v26-*.apk"))
 if len(protected)!=1 or not protected[0].is_file() or protected[0].is_symlink():
  raise RuntimeError("unique_protected_rollback_missing")
 old_digest=digest(protected[0])
 if old_digest!=release.get("baseline_apk_sha256"):
  raise RuntimeError("rollback_checksum_unexpected")
 expected={previous:old_digest,current:EXPECTED_V26}
 total=0;actions=[]
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 if REPORT.is_symlink():raise RuntimeError("report_is_symlink")
 for source,want in expected.items():
  if not safe(source):actions.append({"name":source.name,"skipped":"absent_or_not_safe"});continue
  if digest(source)!=want or proc_uses(source):
   actions.append({"name":source.name,"skipped":"checksum_or_live_usage"});continue
  metadata=source.stat()
  dest=REMOTE+"/"+source.name
  if remote_exists(dest):
   if adb("shell","sha256sum",dest).split()[0]!=want:
    raise RuntimeError("existing_remote_archive_different")
  else:
   part=dest+".part"
   adb("shell","mkdir","-p",REMOTE)
   adb("push",str(source),part,timeout=180)
   if adb("shell","sha256sum",part).split()[0]!=want:
    raise RuntimeError("remote_staging_checksum_error")
   adb("shell","mv",part,dest)
  if adb("shell","sha256sum",dest).split()[0]!=want:raise RuntimeError("remote_archive_verify_failed")
  if not (healthy() and source.exists() and digest(source)==want
      and source.stat().st_mtime_ns==metadata.st_mtime_ns
      and not proc_uses(source)):
   raise RuntimeError("camera_or_source_changed_during_archive")
  with REPORT.open("a",encoding="utf-8") as output:
   output.write(json.dumps({"old":str(source),"microSD":dest,
    "sha256":want,"bytes":metadata.st_size})+"\n")
   output.flush();os.fsync(output.fileno())
  source.unlink()
  total+=metadata.st_size
  actions.append({"name":source.name,"result":"verified_microSD_archive","bytes":metadata.st_size})
 # Verify the preserved rollback remains exact and phone is recording.
 if digest(protected[0])!=old_digest:raise RuntimeError("protected_rollback_changed")
 end=healthy()
 after=shutil.disk_usage("/").free
 print("S9_V26_REDUNDANT_BUILD_OFFLOAD "+json.dumps({
  "files":actions,"bytes_verified":total,"root_free_before":before,
  "root_free_after":after,"net_recovered_bytes":after-before,
  "camera_4k_gpu_healthy":True,"camera_temp_c":end.get("temperature_c"),
  "rollback_preserved":True,"recordings_changed":False},sort_keys=True),flush=True)
if __name__=="__main__":main()
