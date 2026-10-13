#!/usr/bin/env python3
"""One-time guarded S9+ v1c cutover after the EXISTING C720P ADB bridge returns.

The script runs locally as the user's systemd service, not in ChatGPT. It never
touches S3/S5, installs nothing unless the exact S9+ is reachable and stable,
and retains a signed rollback APK. It records results on C720P, not on SD.
"""
from pathlib import Path
import hashlib,json,os,re,subprocess,time,urllib.request,zipfile

HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-onphone-prepended-mp4-v1c"
BACK=HOME/"backups/s9-prepended-v1c-one-time"
REPORT=HOME/"build/s9-onphone-prepended-mp4-v1c/local-cutover-result.json"
PHONE="192.168.178.250:5555"
PKG="nl.kalenel.s9security"
CERT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(argv,seconds=30):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=seconds)
 if p.returncode:raise RuntimeError("command_failed_"+str(argv[:4])+":"+p.stderr[-200:])
 return p.stdout
def adb(*args,seconds=28):return run(["adb","-s",PHONE,*args],seconds)
def signer(p):
 txt=run(["apksigner","verify","--print-certs",str(p)],seconds=25)
 if CERT not in txt:raise RuntimeError("apk_signer_not_authorized")
def model_hashes(p):
 with zipfile.ZipFile(p) as z:
  return {n:hashlib.sha256(z.read("assets/"+n)).hexdigest()
          for n in ("detect.tflite","face_embedding.tflite","labelmap.txt")}
def state():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:
  return json.load(r)
def healthy(x,require_new=False):
 good=(x.get("ok") is True and x.get("mode")=="watching" and
   x.get("native_4k_enabled") is True and x.get("garden_person_gate_backend")=="gpu" and
   x.get("preroll_ready") is True and x.get("temperature_c",999)<34.5 and
   x.get("last_frame_age_ms",9999)<2500 and
   x.get("sd_free_bytes",0)>15*1024**3)
 if require_new:
  return good and x.get("preroll_prepend_enabled") is True and (
   "preroll_prepend_halted_after_failures" in x) and (
    x.get("preroll_prepend_halted_after_failures") is False)
 return good
def launch():
 adb("shell","am","start","-n",PKG+"/.CameraActivity",
     "--ez","enable_native_camera","true",seconds=40)
def write_report(out):
 RELEASE.mkdir(mode=0o700,parents=True,exist_ok=True)
 tmp=REPORT.with_suffix(".tmp")
 tmp.write_text(json.dumps(out,sort_keys=True,indent=2)+"\n")
 os.replace(tmp,REPORT)
def main():
 manifest=RELEASE/"release.json"
 if not manifest.is_file():
  print("S9_AUTO_CUTOVER_WAITING_FOR_SIGNED_RELEASE",flush=True);return 0
 m=json.loads(manifest.read_text());target=Path(m["apk"])
 if not target.is_file() or digest(target)!=m["sha256"] or m["signer_sha256"]!=CERT:
  raise RuntimeError("signed_v1c_artifact_changed")
 if target.stat().st_size>35000000:raise RuntimeError("unexpected_apk_size")
 signer(target)
 if model_hashes(target)!=m["model_sha256"]:raise RuntimeError("model_checksum_changed")
 if REPORT.is_file():
  print("S9_AUTO_CUTOVER_ALREADY_RESOLVED",REPORT.read_text()[:500],flush=True)
  return 0
 try:
  run(["adb","connect",PHONE],seconds=13)
  actual=adb("shell","getprop","ro.product.model",seconds=10).strip()
  if not actual.startswith("SM-G965"):
   print("S9_AUTO_CUTOVER_WAITING_FOR_AUTHORIZED_S9_ADB",actual[:30],flush=True)
   return 0
  adb("forward","tcp:18808","tcp:8808",seconds=12)
  first=state()
 except Exception as e:
  print("S9_AUTO_CUTOVER_WAITING_FOR_PHONE",type(e).__name__,flush=True)
  return 0
 if "preroll_prepend_halted_after_failures" in first:
  write_report({"result":"v1c_already_running_pending_merged_mp4_proof",
   "release_sha256":m["sha256"],"4k_enabled":first.get("native_4k_enabled"),
   "combined_count":first.get("preroll_prepend_merged"),"recordings_preserved":True})
  print("S9_V1C_PREEXISTING_VERIFIED",flush=True)
  return 0
 if not healthy(first):
  print("S9_AUTO_CUTOVER_WAITING_FOR_COOL_IDLE_HEALTHY_4K",{
     k:first.get(k) for k in ("mode","temperature_c","garden_person_gate_backend",
      "preroll_ready","sd_free_bytes")},flush=True)
  return 0
 # Two separate checks prevent interrupting a live recording whose state
 # switched between the first probe and the actual APK install.
 time.sleep(24)
 try:second=state()
 except Exception:
  print("S9_AUTO_CUTOVER_PHONE_DROPPED_DURING_IDLE_GUARD",flush=True);return 0
 if not healthy(second) or second.get("recorded")!=first.get("recorded"):
  print("S9_AUTO_CUTOVER_RECORDING_ACTIVITY_OR_HEALTH_CHANGE",flush=True);return 0
 pm=adb("shell","pm","path",PKG,seconds=14)
 paths=re.findall(r"package:(/[^\s]+base[.]apk)",pm)
 if len(paths)!=1:raise RuntimeError("installed_package_path_unexpected")
 if os.statvfs(HOME).f_bavail*os.statvfs(HOME).f_frsize<85000000:
  print("S9_AUTO_CUTOVER_LOW_HUB_DISK",flush=True);return 0
 BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
 saved=BACK/"before-v1c.apk"
 # Reuse a verified backup on a previous idle-window abort; never overwrite.
 if not saved.is_file():
  adb("pull",paths[0],str(saved),seconds=100)
 signer(saved)
 if model_hashes(saved)!=model_hashes(target):
  raise RuntimeError("rollback_camera_models_incompatible")
 changed=False
 try:
  third=state()
  if not healthy(third) or third.get("recorded")!=second.get("recorded"):
   print("S9_AUTO_CUTOVER_STARTED_NEW_EVENT_ABORT",flush=True);return 0
  changed=True
  adb("shell","am","force-stop",PKG,seconds=18)
  msg=adb("install","-r","-g",str(target),seconds=180)
  if "Success" not in msg:raise RuntimeError("install_missing_success")
  launch()
  verified=None
  for attempt in range(45):
   time.sleep(2)
   try:
    candidate=state()
    if healthy(candidate,True):
     verified=candidate;break
   except Exception:pass
  if verified is None:raise RuntimeError("new_apk_camera_health_or_merge_guard_failed")
  out={"result":"v1c_live_camera_healthy_pending_merged_mp4_proof",
   "release_sha256":m["sha256"],
   "status_version":verified.get("preroll_prepend_version"),
   "4k_enabled":True,"gpu_inference":verified.get("garden_person_gate_backend"),
   "temperature_c":verified.get("temperature_c"),
   "combined_count":verified.get("preroll_prepend_merged"),
   "combined_failures":verified.get("preroll_prepend_errors"),
   "backup":str(saved),"recordings_preserved":True}
  write_report(out)
  print("S9_AUTO_CUTOVER_SAFELY_INSTALLED",json.dumps(out,sort_keys=True),flush=True)
 except BaseException as error:
  print("S9_V1C_CUTOVER_FAILED",type(error).__name__,str(error)[:400],flush=True)
  if changed:
   try:
    adb("shell","am","force-stop",PKG,seconds=18)
    response=adb("install","-r","-g",str(saved),seconds=180)
    if "Success" not in response:raise RuntimeError("rollback_apk_not_installed")
    launch()
    restored=False
    for attempt in range(38):
     time.sleep(2)
     try:
      if healthy(state()):restored=True;break
     except Exception:pass
    write_report({"result":"rollback_completed" if restored else "rollback_not_verified",
      "reason":type(error).__name__,"backup":str(saved)})
    print("S9_V1C_ROLLBACK",restored,flush=True)
   except Exception as sub:
    write_report({"result":"manual_recovery_needed",
      "reason":type(error).__name__,"rollback_failure":str(sub)[:180],
      "backup":str(saved)})
  raise
if __name__=="__main__":main()
