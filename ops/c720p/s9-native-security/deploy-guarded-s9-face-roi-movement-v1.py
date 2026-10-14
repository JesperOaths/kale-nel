#!/usr/bin/env python3
"""Guarded S9+ Camera2 face-ROI release install with signed APK rollback.

Protect the current surveillance recorder and originals: install only during a
stable healthy idle window, back up exact on-device APK, do not delete MP4s,
verify 4K + GPU + preroll and that in-phone FFmpegKit merger is ABSENT.
"""
from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,time,urllib.request,zipfile
HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-face-roi-movement-v1/release.json"
REPORT=HOME/"build/s9-face-roi-movement-v1/live-cutover.json"
BACK=HOME/"backups/s9-face-roi-movement-v1"
MODEL="SM-G965F"
PACKAGE="nl.kalenel.s9security"
CERT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
def run(a,sec=35):
 p=subprocess.run(a,text=True,capture_output=True,timeout=sec)
 if p.returncode:raise RuntimeError("command failed "+str(a[:5])+": "+p.stderr[-450:])
 return p.stdout
def adb(serial,*args,sec=28):return run(["adb","-s",serial,*args],sec)
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
 return h.hexdigest()
def signer(path):
 out=run(["apksigner","verify","--print-certs",str(path)],110)
 if CERT not in out:raise RuntimeError("bad_apk_signer")
def status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:return json.load(r)
def healthy(s):
 return s.get("ok") is True and s.get("mode")=="watching" and s.get("native_4k_enabled") is True and (
  s.get("garden_person_gate_backend")=="gpu") and s.get("preroll_ready") is True and (
  s.get("temperature_c",100)<36.7) and s.get("sd_free_bytes",0)>10*1024**3 and (
  s.get("last_frame_age_ms",999999)<2600)
def reconnect(serial):
 adb(serial,"forward","tcp:18808","tcp:8808",sec=13)
def launch(serial):
 adb(serial,"shell","am","start","-n",PACKAGE+"/.CameraActivity",
    "--ez","enable_native_camera","true",sec=38)
def save_report(obj):
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 t=REPORT.with_suffix(".tmp")
 t.write_text(json.dumps(obj,indent=2)+"\n");os.replace(t,REPORT)
def main():
 if REPORT.exists():
  print("S9_ROI_DEPLOY_RESULT_ALREADY_EXISTS",REPORT.read_text()[:380],flush=True)
  return
 m=json.loads(RELEASE.read_text())
 target=Path(m["apk"])
 if m.get("unsafe_in_app_merger_included") is not False:raise RuntimeError("unsafe_ffmpeg_joiner_present")
 if not target.is_file() or sha(target)!=m["sha256"]:raise RuntimeError("release_sha_mismatch")
 signer(target)
 with zipfile.ZipFile(target) as z:
  if any(b"GardenJoinedClip" in z.read(d) for d in z.namelist() if d.endswith(".dex")):
   raise RuntimeError("unsafe_merger_class_remains_in_dex")
  if not any(b"high_resolution_isolated_person_head_roi_v2" in z.read(d) for d in z.namelist() if d.endswith(".dex")):
   raise RuntimeError("face_roi_not_compiled")
 drive=run(["adb","devices","-l"],18).splitlines()
 usb=[r.split()[0] for r in drive if "model:SM_G965F" in r and "usb:" in r and " device " in r]
 serial=usb[0] if len(usb)==1 else "192.168.178.250:5555"
 if adb(serial,"shell","getprop","ro.product.model",sec=15).strip()!=MODEL:
  raise RuntimeError("unexpected_phone_id")
 check=status()
 if not healthy(check):
  print("S9_FACE_ROI_DEPLOY_DEFERRED_CAMERA_BUSY_OR_HOT",{
    "mode":check.get("mode"),"temp":check.get("temperature_c"),
    "gpu":check.get("garden_person_gate_backend")},flush=True)
  return
 # Ensure no motion event begins across guard window before touching APK.
 time.sleep(16)
 later=status()
 if not healthy(later) or later.get("recorded")!=check.get("recorded"):
  print("S9_FACE_ROI_DEPLOY_DEFERRED_EVENT_OR_HEALTH_CHANGE",flush=True);return
 if os.statvfs(HOME).f_bavail*os.statvfs(HOME).f_frsize<60*1024**2:
  print("S9_FACE_ROI_DEPLOY_DEFERRED_HUB_LOW_DISK",flush=True);return
 pkg=adb(serial,"shell","pm","path",PACKAGE,sec=15)
 matches=[line.partition(":")[2].strip() for line in pkg.splitlines()
      if line.startswith("package:") and line.endswith("base.apk")]
 if len(matches)!=1:raise RuntimeError("apk_backup_path_ambiguous")
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 old=BACK/("before-face-roi-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
 adb(serial,"pull",matches[0],str(old),sec=95)
 signer(old)
 # Back up before any interruption; failure here leaves camera unchanged.
 changed=False
 try:
  third=status()
  if not healthy(third) or third.get("recorded")!=later.get("recorded"):
   print("S9_FACE_ROI_DEPLOY_DEFERRED_LATE_EVENT",flush=True)
   return
  changed=True
  adb(serial,"shell","am","force-stop",PACKAGE,sec=15)
  install=adb(serial,"install","-r","-g",str(target),sec=180)
  if "Success" not in install:raise RuntimeError("apk_install_not_confirmed")
  launch(serial)
  verified=None
  for n in range(38):
   time.sleep(2)
   try:
    reconnect("192.168.178.250:5555")
    s=status()
    if healthy(s) and s.get("preroll_prepend_enabled") is not True and (
      not s.get("preroll_prepend_version") or s.get("preroll_prepend_halted_after_failures") is not True):
     verified=s
     break
   except Exception:pass
  if verified is None:raise RuntimeError("camera_health_4k_gpu_preroll_not_verified")
  result={"installed":True,"health":"camera_4k_gpu_preroll_healthy",
    "face_source":"high_resolution_isolated_person_head_roi_v2",
    "movement_source":"clip_scoped_2d_screen_movement_not_gait",
    "unsafe_ffmpeg_joiner":False,
    "phone_model":MODEL,"wireless_adb":True,"rollback_apk":str(old),
    "release_sha256":m["sha256"],"temperature_c":verified.get("temperature_c"),
    "original_recordings_untouched":True,
    "face_matches_validated_on_real_frontal_subject":False}
  save_report(result)
  print("S9_FACE_ROI_MOTION_V1_INSTALLED_LIVE",json.dumps(result),flush=True)
 except BaseException as e:
  if changed:
   try:
    adb(serial,"shell","am","force-stop",PACKAGE,sec=15)
    out=adb(serial,"install","-r","-g",str(old),sec=180)
    if "Success" not in out:raise RuntimeError("rollback_install_unconfirmed")
    launch(serial)
    recovered=False
    for _ in range(30):
     time.sleep(2)
     try:
      reconnect("192.168.178.250:5555")
      if healthy(status()):recovered=True;break
     except Exception:pass
    save_report({"installed":False,"rollback_performed":True,"rollback_healthy":recovered,
      "error":str(e)[:200],"rollback_apk":str(old)})
    print("S9_FACE_ROI_ROLLBACK",recovered,flush=True)
   except Exception as rb:
    save_report({"installed":False,"rollback_performed":False,
      "error":str(e)[:200],"rollback_error":str(rb)[:200],"rollback_apk":str(old)})
  raise
if __name__=="__main__":main()
