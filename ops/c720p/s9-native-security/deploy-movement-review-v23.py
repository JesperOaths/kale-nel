#!/usr/bin/env python3
"""Deploy authenticated, metadata-only S9 movement review; never modifies clips.

Download three pinned sources at an immutable GitHub commit, enforce SHA256,
back up all targets and the catalog, install atomically, rebuild the catalog
and restart only the read-only archive service; rollback if recordings
disappear or the movement-view contract is not served by Home Assistant.
This job never installs an Android APK or changes the camera.
"""
import argparse,datetime as dt,hashlib,json,os,re,stat,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path("/home/jespern/c720p-home-hub")
WWW=Path("/opt/homeassistant/config/www/frontyard-security-new")
FILES={
 "catalog":(ROOT/"bin/c720p-s9-local-sd-catalog.py","ops/c720p/s9-person-ml-v1/local-sd-catalog.py"),
 "proxy":(ROOT/"bin/s9_sd_proxy_extension.py","ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py"),
 "face":(WWW/"security-face-folders-v22.html","ops/c720p/s9-native-security/security-face-folders-v22.html")}
INDEX=WWW/"s9-phone-events.json"
BACKUPS=ROOT/"backups/s9-movement-evidence-v23"
HOST="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
def sha(data):return hashlib.sha256(data).hexdigest()
def fetch(url,limit):
 with urllib.request.urlopen(url,timeout=35) as res:
  if res.status!=200:raise RuntimeError("source_not_available")
  b=res.read(limit+1)
 if len(b)>limit or len(b)<150:raise RuntimeError("source_size_invalid")
 return b
def api():
 raw=fetch("http://127.0.0.1:8795/new/api/saved",4200000)
 obj=json.loads(raw)
 if obj.get("archive_mode")!="S9-microSD-only" or not isinstance(obj.get("events"),list):
  raise RuntimeError("native_sd_catalog_unavailable")
 return obj
def run(args,timeout=65):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("service_command_failed")
def write(path,data,st):
 fd,tmp=tempfile.mkstemp(prefix=".movement-v23-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:out.write(data);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode) if st else 0o644)
  if st:
   try:os.chown(tmp,st.st_uid,st.st_gid)
   except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 for k in FILES:p.add_argument("--"+k+"-sha",required=True)
 args=p.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",args.ref):raise RuntimeError("immutable_commit_required")
 before=api();identifiers={x.get("clip_no") for x in before["events"]}
 checks={"catalog":"image_movement_direction","proxy":"movement_evidence_scope","face":"movementBuckets"}
 staged={}
 for k,(target,relative) in FILES.items():
  want=getattr(args,k+"_sha")
  if not re.fullmatch("[a-f0-9]{64}",want):raise RuntimeError("expected_sha_invalid")
  body=fetch(HOST+args.ref+"/"+relative,250000)
  if sha(body)!=want or checks[k].encode() not in body:
   raise RuntimeError("source_integrity_or_contract_"+k)
  if k!="face":
   with tempfile.TemporaryDirectory(prefix="v23-compile-") as scratch:
    code=Path(scratch)/"test.py";code.write_bytes(body)
    run(["/usr/bin/python3","-m","py_compile",str(code)],timeout=15)
  staged[target]=body
 if any(not path.is_file() or path.is_symlink() for path in staged):
  raise RuntimeError("unexpected_live_target")
 original={p:(p.read_bytes(),p.stat()) for p in list(staged)+[INDEX]}
 BACKUPS.mkdir(parents=True,exist_ok=True);os.chmod(BACKUPS,0o700)
 backup=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(mode=0o700)
 for i,(path,(data,_)) in enumerate(original.items()):
  copy=backup/(str(i)+"-"+path.name)
  copy.write_bytes(data);os.chmod(copy,0o600)
  if copy.read_bytes()!=data:raise RuntimeError("backup_not_verified")
 if any(p.read_bytes()!=v[0] for p,v in original.items()):
  raise RuntimeError("concurrent_file_change")
 changed=[]
 try:
  for path,body in staged.items():
   if body!=original[path][0]:
    write(path,body,original[path][1]);changed.append(path)
  run(["systemctl","--user","start","c720p-s9-local-sd-catalog.service"],timeout=200)
  run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
  response=None
  for _ in range(8):
   try:response=api();break
   except Exception:time.sleep(2)
  if response is None:raise RuntimeError("api_after_restart_unhealthy")
  now={x.get("clip_no") for x in response["events"]}
  if not identifiers.issubset(now):raise RuntimeError("recordings_missing_after_index_update")
  served=fetch("http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html?v=v23",250000)
  if sha(served)!=sha(staged[WWW/"security-face-folders-v22.html"]):
   raise RuntimeError("home_assistant_ui_readback_mismatch")
  if "sampled_box_tracklets_v1" not in (ROOT/"bin/c720p-s9-local-sd-catalog.py").read_text():
   raise RuntimeError("clip_scoping_lost")
  print("S9_MOVEMENT_REVIEW_V23_DEPLOY_PASS "+json.dumps({
   "clips_preserved":len(response["events"]),"archive_mode":response["archive_mode"],
   "changed_files":len(changed),"backup":str(backup),"ui_http_verified":True,
   "camera_apk_changed":False,"original_recordings_changed":False}),flush=True)
 except BaseException:
  for path in reversed(changed):
   try:write(path,original[path][0],original[path][1])
   except Exception:print("S9_MOVEMENT_REVIEW_V23_RESTORE_REQUIRED "+path.name,flush=True)
  if INDEX.read_bytes()!=original[INDEX][0]:
   try:write(INDEX,original[INDEX][0],original[INDEX][1])
   except Exception:print("S9_MOVEMENT_REVIEW_V23_CATALOG_RESTORE_REQUIRED",flush=True)
  try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
  except Exception:print("S9_MOVEMENT_REVIEW_V23_ARCHIVE_RESTART_REQUIRED",flush=True)
  print("S9_MOVEMENT_REVIEW_V23_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
