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
def verify_complete_video(m):
 try:
  run(["adb","connect",PHONE],seconds=12)
  adb("forward","tcp:18808","tcp:8808",seconds=12)
  status=state()
  count=int(status.get("preroll_prepend_merged") or 0)
  name=str(status.get("preroll_prepend_last_name") or "")
  if status.get("preroll_prepend_halted_after_failures"):
   print("S9_V1C_MERGER_HALTED_CAMERA_PRESERVED",status.get("preroll_prepend_last_error"),flush=True)
   return
  if count<1 or not re.fullmatch(r"motion_[0-9]{13}[.]mp4[.]complete[.]mp4",name):
   print("S9_V1C_MERGE_EVIDENCE_NOT_YET_READY",count,status.get("preroll_prepend_errors"),flush=True)
   return
  original=name.replace(".complete.mp4","")
  duration=int(status.get("preroll_prepend_last_duration_ms") or 0)
  pretime=int(status.get("preroll_prepend_last_prefix_ms") or 0)
  if duration<pretime+700 or pretime<500:
   print("S9_V1C_MERGED_DURATION_NOT_VERIFIED",duration,pretime,flush=True)
   return
  bytes_by_type={}
  for kind,p in (("merged",name),("original",original),("preroll",original+".preroll.mp4")):
   u="http://127.0.0.1:18808/clip/"+p
   with urllib.request.urlopen(urllib.request.Request(u,method="HEAD"),timeout=20) as response:
    if response.status!=200 or "video/mp4" not in response.headers.get("Content-Type",""):
     raise RuntimeError("video_head_invalid_"+kind)
    bytes_by_type[kind]=int(response.headers.get("Content-Length","0"))
  if min(bytes_by_type.values())<10000:
   raise RuntimeError("video_part_truncated")
  url="http://127.0.0.1:8794/new/saved/complete/"+original
  req=urllib.request.Request(url,headers={"Range":"bytes=0-4095"})
  with urllib.request.urlopen(req,timeout=20) as res:
   sample=res.read(4096)
   if res.status!=206 or sample[4:8]!=b"ftyp":
    raise RuntimeError("joined_http_range_invalid")
  result={"result":"one_complete_pre_event_mp4_verified",
   "release_sha256":m["sha256"],"file":name,"merged_bytes":bytes_by_type["merged"],
   "original_4k_bytes":bytes_by_type["original"],"pre_event_bytes":bytes_by_type["preroll"],
   "pre_event_ms":pretime,"combined_duration_ms":duration,
   "joined_count":count,"join_failures":status.get("preroll_prepend_errors"),
   "native_4k_original_preserved":True,
   "signed_archive_range_verified":True}
  tool=__import__("shutil").which("ffprobe")
  if tool:
   clipurl="http://127.0.0.1:18808/clip/"+name
   probe=subprocess.run([tool,"-v","error","-select_streams","v:0",
      "-show_entries","stream=width,height,avg_frame_rate,codec_name",
      "-of","json",clipurl],capture_output=True,text=True,timeout=40)
   if probe.returncode!=0:raise RuntimeError("ffprobe_failed_"+probe.stderr[-130:])
   streams=json.loads(probe.stdout).get("streams",[])
   if not streams or streams[0].get("width")!=1280 or streams[0].get("height")!=720:
    raise RuntimeError("joined_playback_resolution_invalid")
   result["codec"]=streams[0].get("codec_name")
   result["frame_rate"]=streams[0].get("avg_frame_rate")
  write_report(result)
  print("S9_V1C_COMBINED_PRE_ROLL_AND_MOTION_VERIFIED",json.dumps(result,sort_keys=True),flush=True)
 except Exception as e:
  print("S9_V1C_JOINED_MP4_PROOF_PENDING",type(e).__name__,str(e)[:200],flush=True)

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
  previous=json.loads(REPORT.read_text())
  if previous.get("result") in ("v1c_live_camera_healthy_pending_merged_mp4_proof",
                                "v1c_already_running_pending_merged_mp4_proof"):
   verify_complete_video(m)
  else:
   print("S9_AUTO_CUTOVER_ALREADY_RESOLVED",previous.get("result"),flush=True)
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
