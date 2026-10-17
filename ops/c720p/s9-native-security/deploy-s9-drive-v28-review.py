#!/usr/bin/env python3
"""Guarded, metadata-only V28 Drive person review UI rollout on C720P.

Pinned immutable Git revision; audit four source blobs; test before installing;
preserve verified Drive/S9 media; back up originals; rollback on failure.
"""
import argparse,datetime,hashlib,importlib.util,json,os,pathlib,re,subprocess,sys,tempfile,time,urllib.request

HOME=pathlib.Path("/home/jespern/c720p-home-hub")
LIVE=HOME/"bin/s9_drive_visitor_review.py"
PAGE=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
BACKUP=HOME/"backups/s9-drive-v28-person-review"
BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
ITEMS={
 "review":"s9-person-ml-v1/s9_drive_visitor_review.py",
 "patch":"s9-native-security/patch-drive-visitor-review-ui.py",
 "tests":"s9-native-security/test-drive-visitor-review.py",
 "appearance":"s9-native-security/s9_appearance_review.py"
}

def digest(data):
 return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()

def api(path):
 with urllib.request.urlopen("http://127.0.0.1:8795"+path,timeout=23) as response:
  if response.status!=200:raise RuntimeError("api_not_200")
  return json.load(response)

def cam():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=15) as response:
  result=json.load(response)
 if not result.get("ok") or result.get("mode")!="watching" or not result.get("continuous_4k_ready"):
  raise RuntimeError("live_camera_unhealthy_or_recording")
 return result

def run(command,timeout):
 result=subprocess.run(command,capture_output=True,text=True,timeout=timeout)
 if result.returncode:raise RuntimeError("validation_command_failed:"+result.stderr[-500:])
 return result.stdout.strip()

def atomic(target,data,mode):
 with tempfile.NamedTemporaryFile(dir=target.parent,prefix=".s9-v28-ui-",delete=False) as temporary:
  temp=pathlib.Path(temporary.name)
  temporary.write(data);temporary.flush();os.fsync(temporary.fileno())
 try:
  os.chmod(temp,mode)
  os.replace(temp,target)
 finally:temp.unlink(missing_ok=True)

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--ref",required=True)
 for name in ITEMS:parser.add_argument("--"+name+"-blob",required=True)
 opt=parser.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",opt.ref):raise RuntimeError("immutable_revision_required")
 for name in ITEMS:
  if not re.fullmatch(r"[a-f0-9]{40}",getattr(opt,name+"_blob")):
   raise RuntimeError("source_hash_missing")
 cam()
 before=api("/new/api/drive-person-review")
 native=api("/new/api/saved")
 if not before.get("ok") or before.get("processed",0)<100 or native.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("archive_or_drive_catalog_missing")
 original_names={e.get("clip_no") for e in native.get("events",[])}
 if len(original_names)<100:raise RuntimeError("original_video_count_too_small")
 if not LIVE.is_file() or LIVE.is_symlink() or not PAGE.is_file() or PAGE.is_symlink():
  raise RuntimeError("unexpected_live_file")
 with tempfile.TemporaryDirectory(dir="/dev/shm",prefix="s9-v28-review-") as directory:
  stage=pathlib.Path(directory)/"ops/c720p"
  for name,relative in ITEMS.items():
   path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True)
   req=urllib.request.Request(BASE+opt.ref+"/ops/c720p/"+relative,
    headers={"User-Agent":"S9DriveV28ReviewPinned/1"})
   with urllib.request.urlopen(req,timeout=40) as response:
    data=response.read(300001)
   if not 100<len(data)<300000 or digest(data)!=getattr(opt,name+"_blob"):
    raise RuntimeError("immutable_blob_mismatch:"+name)
   path.write_bytes(data)
   run([sys.executable,"-m","py_compile",str(path)],15)
  env=dict(os.environ,PYTHONPATH=str(stage/"s9-native-security"))
  test=stage/ITEMS["tests"]
  result=subprocess.run([sys.executable,str(test)],env=env,
   capture_output=True,text=True,timeout=80)
  if result.returncode:raise RuntimeError("synthetic_review_tests_failed:"+result.stderr[-900:])
  spec=importlib.util.spec_from_file_location("s9_v28_review_patch",stage/ITEMS["patch"])
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  page_before=PAGE.read_bytes()
  new_page=mod.patch(page_before.decode("utf-8")).encode("utf-8")
  new_source=(stage/ITEMS["review"]).read_bytes()
  if b"v28_review_progress" not in new_source or b"S9+ historical recheck pending" not in new_page:
   raise RuntimeError("required_review_labels_missing")
  if mod.patch(new_page.decode("utf-8")).encode("utf-8")!=new_page:
   raise RuntimeError("review_ui_patch_not_idempotent")
  old_source=LIVE.read_bytes()
  if cam().get("mode")!="watching":raise RuntimeError("camera_busy")
  if LIVE.read_bytes()!=old_source or PAGE.read_bytes()!=page_before:
   raise RuntimeError("concurrent_live_file_change")
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
  folder=BACKUP/stamp;folder.mkdir(parents=True,mode=0o700)
  for name,data in (("review.py",old_source),("clips.html",page_before)):
   target=folder/name;target.write_bytes(data);os.chmod(target,0o600)
   if target.read_bytes()!=data:raise RuntimeError("backup_not_verified")
  changed=[]
  try:
   if new_source!=old_source:
    atomic(LIVE,new_source,LIVE.stat().st_mode&0o777);changed.append(LIVE)
   if new_page!=page_before:
    atomic(PAGE,new_page,PAGE.stat().st_mode&0o777);changed.append(PAGE)
   run(["systemctl","--user","restart","c720p-drive-security-archive.service"],70)
   after=None
   for attempt in range(8):
    try:
     after=api("/new/api/drive-person-review")
     if "v28_review_progress" in after:break
    except Exception:pass
    time.sleep(2)
   if not after or "v28_review_progress" not in after:
    raise RuntimeError("review_api_did_not_publish_v28")
   progress=after["v28_review_progress"]
   if not after.get("ok") or int(after.get("processed",0))<int(before.get("processed",0)) or \
      progress.get("eligible",0)<int(before.get("processed",0)) or \
      progress.get("completed",0)<1 or progress.get("no_auto_identity") is not True:
    raise RuntimeError("review_progress_or_manual_safeguard_regression")
   refreshed=api("/new/api/saved")
   if not original_names.issubset({e.get("clip_no") for e in refreshed.get("events",[])}):
    raise RuntimeError("native_recording_catalog_regression")
   cam()
   print("S9_DRIVE_V28_REVIEW_UI_DEPLOYED "+json.dumps({
    "source_ref":opt.ref,"files_changed":len(changed),"backup":str(folder),
    "prior_drive_classified":before.get("processed"),
    "drive_verified":progress.get("eligible"),"v28_rechecked":progress.get("completed"),
    "native_recordings_preserved":len(refreshed.get("events",[])),
    "original_media_modified":False,"cloud_writes":False,
    "identities_automatically_verified":False},sort_keys=True),flush=True)
  except BaseException:
   for path,body in ((LIVE,old_source),(PAGE,page_before)):
    if path in changed:
     try:atomic(path,body,path.stat().st_mode&0o777)
     except Exception:print("S9_V28_UI_ROLLBACK_FILE_FAILED "+path.name,flush=True)
   try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],70)
   except Exception:print("S9_V28_UI_ROLLBACK_PROXY_RESTART_FAILED",flush=True)
   print("S9_DRIVE_V28_REVIEW_UI_ROLLED_BACK",flush=True)
   raise
if __name__=="__main__":main()
