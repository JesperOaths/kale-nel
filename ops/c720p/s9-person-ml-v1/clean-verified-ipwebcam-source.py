#!/usr/bin/env python3
"""Delete ONLY verified, finalized IP Webcam internal staging MP4s.

Kept copies: S9 microSD SHA256 + Drive archive MD5/size.
Never deletes: S9 SD archives, Drive objects, unverified clips, current recordings.
"""
import fcntl,hashlib,importlib.util,json,os,re,subprocess as sp,sys,time,urllib.request,urllib.parse
from pathlib import Path
BASE=Path("/home/jespern/c720p-home-hub")
CFG=BASE/"config/drive-security-archive.json"
IDX=BASE/"state/drive-security-archive.json"
LOCK=BASE/"state/drive-security-archive.lock"
LOG=BASE/"state/s9-internal-staging-cleanup.json"
UPLOAD=BASE/"bin/c720p-drive-security-upload.py"
ADB="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
CAM="http://192.168.178.250:8080"
NAME=re.compile(r"^rec_20\d{2}-\d\d-\d\d_\d\d-\d\d\.mp4$")
def run(cmd,timeout=35):
 r=sp.run(cmd,text=True,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError("local_operation_failed_"+str(r.returncode))
 return r.stdout.strip()
def get(path):
 with urllib.request.urlopen(CAM+path,timeout=9) as response:return json.load(response)
def local_status():
 with urllib.request.urlopen("http://127.0.0.1:18798/status",timeout=5) as r:return json.load(r)
def remote_meta(mod,c,row):
 m=mod.remote_meta(c,"new",row["remote_name"])
 if not m or int(m.get("Size",-1))!=int(row.get("size",0)):return False
 h=mod.remote_md5(m)
 return bool(h and h==str(row.get("md5") or "").lower())
def app_manifest(name):
 x=run(["adb","-s",ADB,"exec-out","cat",SD+"/"+name+".verified.json"],timeout=18)
 data=json.loads(x)
 if data.get("name")!=name:return None
 sha=str(data.get("sha256") or "")
 size=int(data.get("bytes") or 0)
 if not re.fullmatch("[0-9a-f]{64}",sha) or size<10000 or size>350*1024*1024:return None
 return data
def compare_sd(name,sha,size):
 st=run(["adb","-s",ADB,"shell","stat","-c","%s",SD+"/"+name],timeout=12)
 if int(st)!=size:return False
 digest=run(["adb","-s",ADB,"shell","sha256sum",SD+"/"+name],timeout=65).split(" ")[0].lower()
 return digest==sha
def atomic(obj):
 LOG.parent.mkdir(parents=True,exist_ok=True)
 tmp=LOG.with_suffix(".json.tmp")
 tmp.write_text(json.dumps(obj,indent=2)+"\n")
 os.replace(tmp,LOG)
def main():
 dry="--apply" not in sys.argv
 result={"time":time.time(),"dry_run":dry,"eligible":[],"removed":[],"skipped":{}}
 LOCK.parent.mkdir(parents=True,exist_ok=True)
 with open(LOCK,"a+") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  c=json.loads(CFG.read_text())
  spec=importlib.util.spec_from_file_location("s9_original_archive",UPLOAD)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  if not mod.remote_ready(c):raise RuntimeError("pinned_drive_credentials_not_healthy")
  run(["adb","connect",ADB],timeout=12)
  s=local_status()
  if not s.get("ok") or s.get("recording_in_progress") or s.get("recording_orphan_present"):
   raise RuntimeError("s9_recorder_not_idle")
  if get("/status.json").get("video_status",{}).get("enabled"):
   raise RuntimeError("IP_Webcam_recorder_is_active")
  catalog=get("/list_videos")
  idx=json.loads(IDX.read_text())
  verified={str(i.get("local_clip_name")):i for i in idx.get("items",[])
   if i.get("camera")=="new" and i.get("method")=="s9-phone-original-verified"
   and i.get("state")=="verified" and i.get("phone_verified_sd")}
  # New archive entries use 'phone_verified_sd' True. All original MP4/SD files preserved.
  count=0
  for item in sorted(catalog,key=lambda v:int(v.get("mtime") or 0)):
   name=str(item.get("name") or "")
   if not NAME.fullmatch(name) or str(item.get("path") or "")!="":continue
   if time.time()-int(item.get("mtime") or 0)<600:
    result["skipped"][name]="too_recent";continue
   row=verified.get(name)
   if not row:
    result["skipped"][name]="drive_archive_missing_or_not_verified";continue
   manifest=app_manifest(name)
   if not manifest:
    result["skipped"][name]="sd_manifest_missing";continue
   size=int(manifest["bytes"])
   if size!=int(item.get("size") or -1) or size!=int(row.get("size") or -1):
    result["skipped"][name]="size_mismatch";continue
   if not compare_sd(name,manifest["sha256"],size):
    result["skipped"][name]="sd_sha256_failed";continue
   if not remote_meta(mod,c,row):
    result["skipped"][name]="drive_checksum_unavailable";continue
   result["eligible"].append({"name":name,"bytes":size})
   if dry or count>=2:continue
   # IP Webcam's own Video archive UI issues POST /remove/<filename>.
   req=urllib.request.Request(CAM+"/remove/"+urllib.parse.quote(name),data=b"",method="POST")
   with urllib.request.urlopen(req,timeout=25) as r:
    if not 200<=r.status<300:raise RuntimeError("camera_remove_http_error")
   remaining=get("/list_videos")
   if name in [x.get("name") for x in remaining]:
    raise RuntimeError("camera_remove_not_confirmed")
   result["removed"].append(name);count+=1
  atomic(result)
  print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("SOURCE_CLEANUP_BLOCKED",type(e).__name__,str(e)[:140],file=sys.stderr)
  sys.exit(1)
