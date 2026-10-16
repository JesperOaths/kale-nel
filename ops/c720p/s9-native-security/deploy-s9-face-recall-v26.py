#!/usr/bin/env python3
"""Guarded S9+ 4K face rescue V26 install, exact current APK rollback."""
from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time,urllib.request,zipfile
ROOT=Path("/home/jespern/c720p-home-hub")
RELEASE=ROOT/"build/s9-face-recall-v26/release.json"
BACK=ROOT/"backups/s9-face-recall-v26"
SERIAL="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
REF=os.environ.get("S9_FACE_RECALL_V26_REF","")
VERSION="s9_onphone_36_samples_person_or_tile_v3"
BASE="http://127.0.0.1:18808"
def run(a,sec=45):
 p=subprocess.run(a,capture_output=True,text=True,timeout=sec)
 if p.returncode:raise RuntimeError("command_failed_"+str(a[:3])+":"+(p.stderr or "")[-300:])
 return p.stdout
def adb(*a,sec=45):return run(["adb","-s",SERIAL,*a],sec)
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
 return h.hexdigest()
def status():
 with urllib.request.urlopen(BASE+"/status",timeout=14) as r:return json.load(r)
def refresh():
 adb("forward","tcp:18808","tcp:8808",sec=25)
def healthy(s):
 return (s.get("ok") is True and s.get("mode")=="watching"
     and s.get("native_4k_enabled") is True
     and s.get("garden_person_gate_backend")=="gpu"
     and s.get("continuous_4k_trial_active") is True
     and s.get("continuous_4k_ready") is True
     and s.get("continuous_4k_buffered_ms",0)>=4400
     and s.get("continuous_4k_dropped_output_frames",1)==0
     and not s.get("continuous_4k_error")
     and s.get("sd_free_bytes",0)>10*1024**3
     and s.get("temperature_c",100)<38.5
     and s.get("last_frame_age_ms",99999)<2600)
def signer(p):
 if SIGNER not in run(["apksigner","verify","--print-certs",str(p)],55):
  raise RuntimeError("APK_signer_changed")
def start():
 adb("shell","am","start","-n",PACKAGE+"/.CameraActivity",
     "--ez","enable_native_camera","true",sec=50)
def wait(version=None,seconds=165):
 starttime=time.monotonic()
 while time.monotonic()-starttime<seconds:
  try:
   refresh();s=status()
   if healthy(s) and (version is None or s.get("face_deep_rescue_version")==version):
    return s
  except Exception:pass
  time.sleep(3)
 raise RuntimeError("camera_4k_gpu_health_or_v26_not_verified")
def archive():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=35) as r:d=json.load(r)
 if d.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_mode_mismatch")
 return {x.get("clip_no") for x in d.get("events",[]) if str(x.get("clip_no","")).startswith("motion_")}
def main():
 if not re.fullmatch(r"[a-f0-9]{40}",REF):raise RuntimeError("immutable_release_ref_required")
 if not RELEASE.is_file():raise RuntimeError("signed_release_missing")
 m=json.loads(RELEASE.read_text())
 signed=Path(m.get("apk",""))
 baseline=Path(ROOT/"build/s9-face-recall-v26/installed-before-v26.apk")
 if m.get("source_sha")!=REF or m.get("historical_face_review")!="bounded_verified_4k_face_tiles_v3":
  raise RuntimeError("wrong_version_or_source")
 if not signed.is_file() or not baseline.is_file() or sha(signed)!=m.get("sha256") or sha(baseline)!=m.get("baseline_apk_sha256"):
  raise RuntimeError("signed_release_or_current_baseline_invalid")
 signer(signed);signer(baseline)
 with zipfile.ZipFile(signed) as new,zipfile.ZipFile(baseline) as old:
  keys=lambda z:sorted(x for x in z.namelist() if x=="AndroidManifest.xml" or x.startswith(("assets/","lib/")))
  if keys(old)!=keys(new) or any(
      hashlib.sha256(old.read(k)).digest()!=hashlib.sha256(new.read(k)).digest()
      for k in keys(old)):raise RuntimeError("model_or_manifest_or_native_libraries_modified")
  if not any(VERSION.encode() in new.read(n) for n in new.namelist() if n.startswith("classes") and n.endswith(".dex")):
   raise RuntimeError("new_face_rescue_code_not_signed")
 free=os.statvfs(str(ROOT))
 if free.f_bavail*free.f_frsize<210*1024**2:raise RuntimeError("hub_disk_too_full")
 if adb("shell","getprop","ro.product.model",sec=20).strip()!="SM-G965F":
  raise RuntimeError("unexpected_phone")
 refresh()
 old_status=wait(seconds=60)
 originals=archive()
 time.sleep(15)
 settle=status()
 if not healthy(settle) or settle.get("recorded")!=old_status.get("recorded"):
  print("S9_V26_FACE_RESCUE_DEFERRED_BUSY",flush=True);return
 path=adb("shell","pm","path",PACKAGE,sec=20).splitlines()
 paths=[line.partition(":")[2].strip() for line in path if line.startswith("package:") and line.endswith("base.apk")]
 if len(paths)!=1:raise RuntimeError("current_installed_package_ambiguous")
 installed=adb("shell","sha256sum",paths[0],sec=25).split()[0]
 if installed!=sha(baseline):raise RuntimeError("on_phone_apk_changed_since_build")
 BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
 old=BACK/("installed-before-v26-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
 if old.exists():raise RuntimeError("rollback_destination_collision")
 import shutil;shutil.copy2(baseline,old)
 signer(old)
 if sha(old)!=installed:raise RuntimeError("rollback_integrity_failed")
 changed=False
 try:
  latest=status()
  if not healthy(latest) or latest.get("recorded")!=settle.get("recorded"):
   print("S9_V26_FACE_RESCUE_DEFERRED_EVENT",flush=True);return
  changed=True
  adb("shell","am","force-stop",PACKAGE,sec=28)
  if "Success" not in adb("install","-r","-g",str(signed),sec=230):
   raise RuntimeError("install_unconfirmed")
  start()
  after=wait(VERSION,seconds=170)
  # Observe multiple successive fresh sensor/4K status updates.
  for _ in range(4):
   time.sleep(5)
   current=status()
   if not healthy(current) or current.get("face_deep_rescue_version")!=VERSION:
    raise RuntimeError("4k_gpu_camera_burnin_failed")
  nowclips=archive()
  if not originals.issubset(nowclips):
   raise RuntimeError("archived_recordings_disappeared")
  report={"installed":True,"on_phone_v26":True,
     "camera_4k_gpu_healthy":True,"archive_clips_preserved":len(nowclips),
     "new_apk_sha256":sha(signed),"exact_rollback_apk":str(old),
     "face_review_version":VERSION,
     "temperature_c":current.get("temperature_c"),
     "original_videos_changed":False,
     "face_detection_accuracy_yet_measured":False}
  print("S9_FACE_RECALL_V26_DEVICE_VERIFIED "+json.dumps(report,sort_keys=True),flush=True)
 except BaseException as err:
  if changed:
   try:
    adb("shell","am","force-stop",PACKAGE,sec=26)
    if "Success" not in adb("install","-r","-g",str(old),sec=230):
     raise RuntimeError("rollback_install_no_success")
    start()
    prior=wait(seconds=170)
    print("S9_FACE_RECALL_V26_ROLLBACK_VERIFIED "+json.dumps({
      "restored_sha256":sha(old),"camera_4k_gpu_healthy":healthy(prior),
      "failure":type(err).__name__}),flush=True)
   except BaseException as rb:
    print("S9_FACE_RECALL_V26_ROLLBACK_REQUIRES_ATTENTION "+type(rb).__name__,flush=True)
  raise
if __name__=="__main__":main()
