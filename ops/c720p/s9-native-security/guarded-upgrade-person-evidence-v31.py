#!/usr/bin/env python3
"""Guarded, reversible S9+ hybrid person detector v8 cutover.

Wait for genuine camera idle, back up installed APK, verify installed/new
model asset hashes and signing certificates, deploy already signed package,
then validate real Camera2 / GPU / periodic scan / thermal. Restore old APK
if anything fails. No original recordings are modified or automatically deleted.
"""
import argparse,datetime as dt,hashlib,json,os
from pathlib import Path
import re,subprocess,time,urllib.request,zipfile

BASE=Path("/home/jespern/c720p-home-hub")
OUT=BASE/"build/s9-person-evidence-v31"
BACK=BASE/"backups/s9-person-evidence-v31"
PHONE="192.168.178.250:5555"
LOCAL=18818
MODEL=("detect.tflite","face_embedding.tflite","labelmap.txt")
CERT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"

def run(args,timeout=40,check=True):
 x=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if check and x.returncode:
  raise RuntimeError("command_failed:"+str(args[:3])+" "+x.stderr[-400:])
 return x
def adb(*args,timeout=45,check=True):
 return run(["adb","-s",PHONE,*args],timeout,check)
def get():
 with urllib.request.urlopen(f"http://127.0.0.1:{LOCAL}/status",timeout=10) as r:
  return json.load(r)
def sha(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  while True:
   b=f.read(1024*1024)
   if not b:break
   h.update(b)
 return h.hexdigest()
def cert(apk):
 x=run(["apksigner","verify","--print-certs",str(apk)],timeout=25)
 m=re.search(r"certificate SHA-256 digest: ([a-f0-9]{64})",x.stdout)
 return m.group(1) if m else ""
def models(path):
 with zipfile.ZipFile(path) as f:
  return {n:hashlib.sha256(f.read("assets/"+n)).hexdigest() for n in MODEL}
def launch():
 adb("shell","am","force-stop","nl.kalenel.s9security",timeout=15,check=False)
 adb("shell","am","start","-n","nl.kalenel.s9security/.CameraActivity",
     "--ez","enable_native_camera","true",timeout=24)
def healthy(j):
 return (j.get("ok") is True and j.get("native_4k_enabled") is True and
         j.get("garden_person_gate_ready") is True and
         j.get("garden_person_gate_backend")=="gpu" and
         j.get("mode") in ("watching","recording","starting") and
         j.get("last_frame_age_ms",99999)<4500 and
         j.get("sd_free_bytes",0)>15*1024**3 and
         j.get("recording_rate_max_per_hour")==24 and
         j.get("temperature_c",999)<38.0)
def wait_status(hybrid,timeout):
 end=time.monotonic()+timeout
 last={}
 while time.monotonic()<end:
  try:
   last=get()
   if healthy(last) and last.get("frames",0)>=35:
    if not hybrid:return last
    if (last.get("person_evidence_version")=="s9_person_evidence_v31" and
        last.get("garden_person_multiscale_version")=="garden_overlapping_person_tiles_v8" and
        last.get("garden_person_followup_version")=="hybrid_periodic_multiscale_v8" and
        last.get("garden_person_sentinel_checks",0)>=5 and
        last.get("garden_person_last_multiscale_passes",0)==3 and
        last.get("garden_person_gate_errors",1)==0 and
        0<last.get("garden_person_inference_last_ms",99999)<2200):
     return last
  except Exception:pass
  time.sleep(2)
 raise RuntimeError("post_install_validation_incomplete:"+json.dumps({
  k:last.get(k) for k in (
   "ok","mode","frames","last_error","temperature_c",
   "garden_person_sentinel_checks","garden_person_last_multiscale_passes",
   "garden_person_inference_last_ms","garden_person_gate_errors",
   "garden_person_gate_backend","garden_person_followup_version")},sort_keys=True))
def main():
 p=argparse.ArgumentParser();p.add_argument("--commit",required=True);a=p.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",a.commit):raise RuntimeError("commit_invalid")
 release=json.loads((OUT/"release.json").read_text())
 apk=Path(release["apk"])
 if (release.get("commit")!=a.commit or
     not apk.is_file() or sha(apk)!=release.get("sha256") or
     release.get("signer_sha256")!=CERT or cert(apk)!=CERT):
  raise RuntimeError("untrusted_apk_or_release_attestation")
 if os.statvfs(str(BASE)).f_bavail*os.statvfs(str(BASE)).f_frsize<190*1024**2:
  raise RuntimeError("hub_disk_not_safe_to_backup_apk")
 sd=adb("shell","df","-h","/storage/9C33-6BBD",timeout=17).stdout
 if "/storage/9C33-6BBD" not in sd:raise RuntimeError("phone_sd_not_mounted")
 adb("forward",f"tcp:{LOCAL}","tcp:8808",timeout=18)
 old=None;changed=False
 try:
  baseline=get()
  if not healthy(baseline) or baseline.get("mode")!="watching":
   raise RuntimeError("cannot_upgrade_active_or_unhealthy_camera")
  if baseline.get("temperature_c",999)>=37:
   raise RuntimeError("phone_too_warm_to_restart_camera")
  installed=adb("shell","pm","path","nl.kalenel.s9security",timeout=18).stdout
  remote=next((line.split("package:",1)[1].strip() for line in installed.splitlines()
              if line.startswith("package:")),None)
  if not remote:raise RuntimeError("no_installed_package_to_backup")
  BACK.mkdir(mode=0o700,parents=True)
  old=BACK/("before-v31-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
  adb("pull",remote,str(old),timeout=80)
  if not 8*1024*1024<old.stat().st_size<30*1024*1024:
   raise RuntimeError("rollback_apk_not_safely_copied")
  if cert(old)!=CERT:raise RuntimeError("installed_apk_signing_certificate_differs")
  # Preserve exactly the face embedding and object detection networks that
  # were actually on the phone (rather than trusting an old build directory).
  if models(old)!=models(apk):raise RuntimeError("installed_face_or_detector_model_would_change")
  with zipfile.ZipFile(apk) as modelArchive:
   if hashlib.sha256(modelArchive.read("assets/person_pose.tflite")).hexdigest()!=release.get("pose_model_sha256"):raise RuntimeError("pose_asset_invalid")
  print("ROLLBACK_APK_VERIFIED",str(old),flush=True)
  # Two separate idle observations. Do not interrupt a live recording.
  for _ in range(2):
   time.sleep(2)
   state=get()
   if state.get("mode")!="watching" or not healthy(state):
    raise RuntimeError("camera_started_recording_or_unhealthy_before_install")
  changed=True
  adb("shell","am","force-stop","nl.kalenel.s9security",timeout=15)
  installed=adb("install","-r","-g",str(apk),timeout=125)
  if "Success" not in installed.stdout:raise RuntimeError("phone_install_not_confirmed")
  launch()
  validated=wait_status(True,timeout=85)
  print("PERSON_EVIDENCE_V31_LIVE_VERIFIED",json.dumps({
   "mode":validated.get("mode"),"native_4k":validated.get("native_4k_enabled"),
   "camera_temp_c":validated.get("temperature_c"),
   "on_phone_backend":validated.get("garden_person_gate_backend"),
   "sentinel_checks":validated.get("garden_person_sentinel_checks"),
   "multiscale_passes":validated.get("garden_person_last_multiscale_passes"),
   "inference_ms":validated.get("garden_person_inference_last_ms"),
   "guard_errors":validated.get("garden_person_gate_errors"),
   "original_models_preserved":True,"backed_up_old_apk":str(old),
   "release_commit":a.commit},sort_keys=True),flush=True)
 except BaseException as err:
  print("PERSON_EVIDENCE_V31_UPGRADE_PROBLEM",type(err).__name__,str(err)[:600],flush=True)
  if changed and old is not None and old.is_file():
   try:
    adb("shell","am","force-stop","nl.kalenel.s9security",timeout=15,check=False)
    rollback=adb("install","-r","-g",str(old),timeout=135)
    if "Success" not in rollback.stdout:raise RuntimeError("install_rollback_unconfirmed")
    launch()
    last=wait_status(False,timeout=70)
    print("ORIGINAL_S9_CAMERA_RESTORED",json.dumps({
     "mode":last.get("mode"),"gpu":last.get("garden_person_gate_backend"),
     "native_4k":last.get("native_4k_enabled")}),flush=True)
   except Exception as back:
    print("ROLLBACK_REQUIRES_MANUAL_REVIEW",type(back).__name__,str(back)[:400],flush=True)
  raise
 finally:
  adb("forward","--remove",f"tcp:{LOCAL}",timeout=16,check=False)
if __name__=="__main__":main()
