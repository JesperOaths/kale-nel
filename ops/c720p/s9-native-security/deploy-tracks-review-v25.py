#!/usr/bin/env python3
"""Deploy authenticated, metadata-only S9 Tracks v25; never modifies clips.

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
 "tracks":(WWW/"security-tracks-v7.html","ops/c720p/s9-native-security/security-tracks-v7.html")}
INDEX=WWW/"s9-phone-events.json"
BACKUPS=ROOT/"backups/s9-tracks-evidence-v25"
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
 fd,tmp=tempfile.mkstemp(prefix=".tracks-v25-",dir=path.parent)
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
 checks={"catalog":"corroborated_person_tracklets_v25","proxy":"person_track_evidence_version","tracks":"s9v25-tracks-script"}
 staged={}
 for k,(target,relative) in FILES.items():
  want=getattr(args,k+"_sha")
  if not re.fullmatch("[a-f0-9]{64}",want):raise RuntimeError("expected_sha_invalid")
  body=fetch(HOST+args.ref+"/"+relative,250000)
  if sha(body)!=want or checks[k].encode() not in body:
   raise RuntimeError("source_integrity_or_contract_"+k)
  if k!="tracks":
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
  served=fetch("http://127.0.0.1:8123/local/frontyard-security-new/security-tracks-v7.html?v=v25",250000)
  if sha(served)!=sha(staged[WWW/"security-tracks-v7.html"]):
   raise RuntimeError("home_assistant_ui_readback_mismatch")
  if "corroborated_person_tracklets_v25" not in (ROOT/"bin/c720p-s9-local-sd-catalog.py").read_text():
   raise RuntimeError("person_evidence_classification_missing")
  # Every exposed recording must carry the new person-only review contract.
  actual=[x for x in response["events"] if re.fullmatch(r"motion_[0-9]{13}[.]mp4",str(x.get("clip_no","")))]
  if any("person_tracks" not in x or "person_track_evidence_version" not in x for x in actual):
   raise RuntimeError("person_review_contract_not_served")
  if any(len(x.get("person_tracks",[]))!=x.get("person_track_count") for x in actual):
   raise RuntimeError("person_counts_inconsistent")
  print("S9_PERSON_TRACKS_V25_DEPLOY_PASS "+json.dumps({
   "clips_preserved":len(response["events"]),"archive_mode":response["archive_mode"],
   "changed_files":len(changed),"backup":str(backup),"ui_http_verified":True,"person_rows":sum(1 for x in actual if x.get("person_track_count",0)>0),
   "review_rows":sum(1 for x in actual if x.get("person_track_review_count",0)>0),
   "camera_apk_changed":False,"original_recordings_changed":False}),flush=True)
 except BaseException:
  for path in reversed(changed):
   try:write(path,original[path][0],original[path][1])
   except Exception:print("S9_PERSON_TRACKS_V25_RESTORE_REQUIRED "+path.name,flush=True)
  if INDEX.read_bytes()!=original[INDEX][0]:
   try:write(INDEX,original[INDEX][0],original[INDEX][1])
   except Exception:print("S9_PERSON_TRACKS_V25_CATALOG_RESTORE_REQUIRED",flush=True)
  try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
  except Exception:print("S9_PERSON_TRACKS_V25_ARCHIVE_RESTART_REQUIRED",flush=True)
  print("S9_PERSON_TRACKS_V25_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
