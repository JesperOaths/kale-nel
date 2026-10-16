#!/usr/bin/env python3
"""Deploy S9 incremental sidecar refresh on C720P, with script rollback."""
import argparse,hashlib,json,os,re,stat,subprocess,tempfile,time,urllib.request
from pathlib import Path
BASE=Path("/home/jespern/c720p-home-hub")
BIN=BASE/"bin/s9-fast-recent-clip-index.py"
UNIT="c720p-s9-fast-recent-clips"
BACK=BASE/"backups/s9-v26-fast-face-sidecar"
ORIGIN="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
def run(*args,timeout=75):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_error:"+str(args[:3])+":"+(p.stderr or "")[-250:])
 return p.stdout.strip()
def api():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=20) as stream:
  data=json.load(stream)
 if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("incorrect_archive_mode")
 return {str(x.get("clip_no")) for x in data.get("events",[])
   if str(x.get("clip_no","")).startswith("motion_")}
def sha(b):return hashlib.sha256(b).hexdigest()
def replace(path,contents,mode):
 fd,tmp=tempfile.mkstemp(prefix=".s9-face-fast-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as stream:
   stream.write(contents);stream.flush();os.fsync(stream.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def ctl(*parts):return run("systemctl","--user",*parts,timeout=75)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 p.add_argument("--sha",required=True)
 a=p.parse_args()
 if not re.fullmatch("[0-9a-f]{40}",a.ref) or not re.fullmatch("[0-9a-f]{64}",a.sha):
  raise RuntimeError("immutable_ref_or_hash_invalid")
 if not BIN.is_file() or BIN.is_symlink():raise RuntimeError("live_script_invalid")
 with urllib.request.urlopen(ORIGIN+a.ref+"/ops/c720p/s9-native-security/fast-recent-s9-clip-index.py",timeout=30) as res:
  updated=res.read(140000)
 if not 5000<len(updated)<140000 or sha(updated)!=a.sha:
  raise RuntimeError("download_digest_mismatch")
 if b"recent_existing_face_updates" not in updated or b"safe_face_review_metadata" not in updated:
  raise RuntimeError("missing_v26_sidecar_contract")
 original=BIN.read_bytes()
 if b"S9_FAST_INDEX_TOTAL" not in original:raise RuntimeError("unexpected_live_fast_index")
 if updated==original:
  print("S9_FACE_FAST_REFRESH_V26_ALREADY_CURRENT",flush=True);return
 prior=api()
 mode=stat.S_IMODE(BIN.stat().st_mode)
 # Check the replacement parser before stopping anything.
 with tempfile.TemporaryDirectory(prefix="s9-face-fast-check-") as tmp:
  check=Path(tmp)/"candidate.py";check.write_bytes(updated)
  run("/usr/bin/python3","-m","py_compile",str(check),timeout=25)
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 backup=BACK/("fast-index-"+a.ref[:12]+".py")
 if backup.exists() and sha(backup.read_bytes())!=sha(original):
  raise RuntimeError("backup_conflict")
 if not backup.exists():
  with backup.open("xb") as fp:fp.write(original);fp.flush();os.fsync(fp.fileno())
  os.chmod(backup,0o600)
 if ctl("is-active",UNIT+".timer")!="active":raise RuntimeError("fast_timer_not_running")
 # Pause the *index* timer only; never touch camera app, MP4s or HA services.
 ctl("stop",UNIT+".timer")
 changed=False
 try:
  for _ in range(14):
   active=subprocess.run(["systemctl","--user","is-active","--quiet",UNIT+".service"])
   if active.returncode!=0:break
   time.sleep(2)
  else:raise RuntimeError("fast_service_still_busy")
  replace(BIN,updated,mode);changed=True
  check=ctl("start",UNIT+".service")
  ctl("start",UNIT+".timer")
  if ctl("is-active",UNIT+".timer")!="active":raise RuntimeError("timer_not_restored")
  if not prior.issubset(api()):raise RuntimeError("archive_clips_missing")
  after=BIN.read_bytes()
  if sha(after)!=a.sha:raise RuntimeError("fast_script_readback_wrong")
  print("S9_FACE_FAST_REFRESH_V26_DEPLOYED "+json.dumps({
   "archive_count_preserved":len(prior),"script_sha256":sha(after),
   "timer_active":True,"face_sidecars_per_tick_max":8,
   "camera_changed":False,"video_files_changed":False,
   "original_script_backup":str(backup)},sort_keys=True),flush=True)
 except BaseException:
  if changed:replace(BIN,original,mode)
  try:ctl("start",UNIT+".timer")
  except Exception:pass
  print("S9_FACE_FAST_REFRESH_V26_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
