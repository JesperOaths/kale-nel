#!/usr/bin/env python3
"""Deploy the v7 30-second post-motion tail on the already verified S9+ 4K APK.

Preserves signed v6 APK for rollback. Only activates after camera idle, stable
GPU/4K ring, and enough space; then proves a real ~39-second single 4K MP4
(7-9s pre-event + >=30s post-event), packet continuity and app-restart
persistence. Diagnostic media is never indexed as a security event.
"""
from pathlib import Path
import datetime,hashlib,json,os,re,statistics,subprocess,tempfile,time,urllib.request
HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-postmotion-v7r2/release.json"
OUTPUT=HOME/"build/s9-postmotion-v7r2/deployment-report.json"
BACK=HOME/"backups/s9-postmotion-v7r2"
SERIAL="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
BASE="http://127.0.0.1:18808"
PHONE_DIR="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
V6_SHA="b11b9b07632f8d31e0a254225876fccf09ccae9448417d92350b9f11c9bb4090"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
VERSION="continuous_native_4k_h264_ring_v1"
SRC_SHA="ab63dc66dcab611d315056f179c6170bf39f6974"

def call(a,timeout=35):
 p=subprocess.run(a,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("failed_command "+repr(a[:4])+" "+p.stderr[-500:])
 return p.stdout
def adb(*a,timeout=35):return call(["adb","-s",SERIAL,*a],timeout=timeout)
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for piece in iter(lambda:f.read(1048576),b""):h.update(piece)
 return h.hexdigest()
def signer(p):
 if SIGNER not in call(["apksigner","verify","--print-certs",str(p)],timeout=40):
  raise RuntimeError("signer_mismatch")
def forward():
 if adb("shell","getprop","ro.product.model",timeout=15).strip()!="SM-G965F":
  raise RuntimeError("wrong_phone")
 adb("forward","tcp:18808","tcp:8808",timeout=20)
def status():
 with urllib.request.urlopen(BASE+"/status",timeout=14) as r:return json.load(r)
def control(key,value):
 data=json.dumps({"key":key,"value":value}).encode()
 req=urllib.request.Request(BASE+"/control",data=data,headers={"Content-Type":"application/json"},method="POST")
 try:
  with urllib.request.urlopen(req,timeout=18) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  return json.loads(e.read().decode())
def healthy(d,expect_tail=False):
 return (d.get("ok") is True and d.get("mode")=="watching" and
  d.get("native_4k_enabled") is True and
  d.get("garden_person_gate_backend")=="gpu" and
  d.get("continuous_4k_production_persisted") is True and
  d.get("continuous_4k_trial_active") is True and
  d.get("continuous_4k_ready") is True and
  d.get("continuous_4k_buffered_ms",0)>=6500 and
  d.get("continuous_4k_dropped_output_frames",1)==0 and
  not d.get("continuous_4k_error") and
  d.get("temperature_c",100)<38.5 and
  d.get("sd_free_bytes",0)>15*1024**3 and
  d.get("last_frame_age_ms",99999)<1500 and
  (not expect_tail or d.get("person_post_motion_hold_ms")==30000))
def wait_idle(hold=14,deadline=190,expect_tail=False):
 started=time.monotonic()
 stable=None
 while time.monotonic()-started<deadline:
  d=status()
  if d.get("temperature_c",100)>=38.5:
   raise RuntimeError("temperature_high_refuse_install_or_test")
  if healthy(d,expect_tail):
   count=d.get("recorded")
   if stable is None or stable[1]!=count:stable=(time.monotonic(),count)
   if time.monotonic()-stable[0]>=hold:return d
  else:stable=None
  time.sleep(2)
 raise RuntimeError("no_safe_4k_idle_window")
def wait_health(expect_tail,seconds=140):
 t=time.monotonic()
 while time.monotonic()-t<seconds:
  try:
   forward()
   d=status()
   if healthy(d,expect_tail):return d
  except Exception:pass
  time.sleep(2)
 raise RuntimeError("native_4k_camera_not_ready_after_install")
def install(p):
 if "Success" not in adb("install","-r","-g",str(p),timeout=210):
  raise RuntimeError("adb_install_no_success")
def launch():
 adb("shell","am","start","-n",PACKAGE+"/.CameraActivity",
  "--ez","enable_native_camera","true",timeout=45)
def video_properties(path):
 props=json.loads(call(["ffprobe","-v","error","-select_streams","v:0",
  "-show_entries","stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
  "-of","json",str(path)],timeout=55))
 return props["streams"][0],float(props["format"]["duration"])
def frame_timing(path):
 d=json.loads(call(["ffprobe","-v","error","-select_streams","v:0",
  "-show_packets","-show_entries","packet=pts_time,flags","-of","json",str(path)],timeout=100))
 p=[float(row["pts_time"]) for row in d["packets"] if "pts_time" in row]
 gaps=[b-a for a,b in zip(p,p[1:])]
 if not gaps:raise RuntimeError("video_packets_absent")
 return {"frames":len(p),"max_gap_s":max(gaps),
  "nonmonotonic":sum(x<=0 for x in gaps),
  "median_frame_interval":statistics.median(x for x in gaps if x>0),
  "keyframes":sum("K" in str(row.get("flags","")) for row in d["packets"])}
def check_test_clip(name):
 with tempfile.TemporaryDirectory(prefix="s9-postmotion-v7r2-proof-",dir="/tmp") as folder:
  p=Path(folder)/name
  adb("pull",PHONE_DIR+"/"+name,str(p),timeout=190)
  if not p.is_file() or p.stat().st_size<15000000:raise RuntimeError("diagnostic_clip_missing")
  video,duration=video_properties(p)
  packets=frame_timing(p)
  if (video.get("codec_name"),video.get("width"),video.get("height"))!=("h264",3840,2160):
   raise RuntimeError("not_genuine_4k_video")
  if not 36<=duration<=55:
   raise RuntimeError("postmotion_diagnostic_not_long_enough_"+str(duration))
  if packets["frames"]<1020 or packets["nonmonotonic"]>0 or packets["max_gap_s"]>0.12 or packets["keyframes"]<12:
   raise RuntimeError("4k_tail_timestamps_invalid_"+str(packets))
  for pos in ("0","8","20","32"):
   call(["ffmpeg","-nostdin","-hide_banner","-threads","1","-v","error",
    "-ss",pos,"-i",str(p),"-map","0:v:0","-frames:v","2","-f","null","-"],timeout=90)
  return {"clip":name,"duration_s":duration,"stream":video,"timing":packets,
   "bytes":p.stat().st_size,"sha256":sha(p),"decodes_at_s":[0,8,20,32]}
def save(data):
 OUTPUT.parent.mkdir(parents=True,exist_ok=True)
 p=OUTPUT.with_name(".deployment-report.tmp")
 p.write_text(json.dumps(data,sort_keys=True,indent=2)+"\n")
 os.replace(p,OUTPUT)
def main():
 m=json.loads(RELEASE.read_text());apk=Path(m["apk"])
 if m.get("source_sha")!=SRC_SHA or not m.get("signed") or sha(apk)!=m["sha256"] or not m.get("models_native_and_manifest_preserved"):
  raise RuntimeError("release_digest_or_source_contract_failed")
 signer(apk)
 if os.statvfs(str(HOME)).f_bavail*os.statvfs(str(HOME)).f_frsize<320*1024**2:
  raise RuntimeError("c720p_disk_below_safe_backup_floor")
 forward()
 before=wait_idle(hold=14)
 if before.get("preroll_version")!=VERSION:
  raise RuntimeError("expected_existing_continuous_4k_encoder")
 if before.get("temperature_c",100)>=38.2:
  print("S9_POSTMOTION_INSTALL_DEFERRED_TEMP",before.get("temperature_c"),flush=True)
  return
 oldpaths=adb("shell","pm","path",PACKAGE).splitlines()
 oldpaths=[row.split(":",1)[1] for row in oldpaths if row.startswith("package:") and row.endswith("base.apk")]
 if len(oldpaths)!=1:raise RuntimeError("ambiguous_installed_apk")
 BACK.mkdir(parents=True,exist_ok=True)
 old=BACK/("before-v7-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
 adb("pull",oldpaths[0],str(old),timeout=130)
 signer(old)
 if sha(old)!=V6_SHA:raise RuntimeError("installed_camera_apk_changed_refuse_install")
 print("SIGNED_V6_ROLLBACK_PRESERVED",str(old),flush=True)
 changed=False
 diagnostic=""
 try:
  d=wait_idle(hold=12)
  if d.get("temperature_c",100)>=38.2:
   print("S9_POSTMOTION_INSTALL_DEFERRED_TEMP",d.get("temperature_c"),flush=True)
   return
  adb("shell","am","force-stop",PACKAGE,timeout=20)
  changed=True
  install(apk);launch()
  got=wait_health(True)
  if got.get("continuous_4k_buffered_ms",0)<6500:raise RuntimeError("not_ready_4k_buffer")
  print("V7_CAMERA_LIVE",json.dumps({k:got.get(k) for k in
   ("mode","continuous_4k_ready","continuous_4k_buffered_ms","person_post_motion_hold_ms",
    "temperature_c","garden_person_gate_backend")}),flush=True)
  # 40s of live full-resolution ring, independent GPU inference and heat safety.
  for i in range(5):
   time.sleep(8)
   d=status()
   if not healthy(d,True):raise RuntimeError("v7_4k_burnin_failed")
   print("V7_BURNIN",i,d.get("temperature_c"),d.get("continuous_4k_dropped_output_frames"),flush=True)
  d=wait_idle(hold=8,expect_tail=True,deadline=110)
  if d.get("temperature_c",100)>=38.2:raise RuntimeError("diagnostic_heat_guard")
  if d.get("preroll_diagnostic_used"):raise RuntimeError("diagnostic_already_used")
  requested=control("preroll_diagnostic","record_tail_once")
  if not requested.get("ok") or requested.get("requested_post_motion_hold_ms")!=30000:
   raise RuntimeError("tail_diagnostic_refused_"+str(requested))
  print("V7_REAL_30S_TAIL_REQUESTED",json.dumps(requested),flush=True)
  for _ in range(110):
   time.sleep(1)
   d=status()
   diagnostic=d.get("preroll_diagnostic_clip","")
   if re.fullmatch(r"diagnostic_preroll_[0-9]{13}\.mp4",diagnostic) and "single_native_4k_complete_" in d.get("preroll_diagnostic_result",""):
    break
   if d.get("temperature_c",100)>=40.5:raise RuntimeError("recording_thermal_safety_failure")
  else:raise RuntimeError("30_second_tail_diagnostic_not_finalized")
  sample=check_test_clip(diagnostic)
  print("REAL_4K_POSTMOTION_30S_MP4_VERIFIED",json.dumps(sample),flush=True)
  # Diagnostic is not surveillance footage. Preserve it until the independent
  # validation has succeeded; remove only this exact test file afterwards.
  adb("shell","rm","--",PHONE_DIR+"/"+diagnostic,timeout=25)
  diagnostic=""
  reboot=wait_idle(hold=14,expect_tail=True,deadline=150)
  if reboot.get("temperature_c",100)>=38.2:raise RuntimeError("not_cool_enough_for_restart")
  adb("shell","am","force-stop",PACKAGE,timeout=20)
  launch()
  after=wait_health(True,seconds=125)
  for i in range(6):
   time.sleep(5)
   after=status()
   if not healthy(after,True):raise RuntimeError("v7_not_persistent_after_app_restart")
  report={"ok":True,"production_deployed":True,"new_apk":str(apk),
   "apk_sha256":sha(apk),"baseline_rollback":str(old),
   "source_sha":m["source_sha"],"post_motion_hold_ms":30000,
   "max_segment_ms":120000,"max_segment_continuation_enabled":True,
   "real_video":sample,"post_boot_4k_buffered_ms":after["continuous_4k_buffered_ms"],
   "post_boot_gpu":after["garden_person_gate_backend"],
   "post_boot_temperature_c":after["temperature_c"],
   "other_video_footage_modified":False}
  save(report)
  print("S9_30S_POSTMOTION_V7_DEPLOYMENT_VERIFIED",json.dumps(report),flush=True)
 except BaseException as error:
  if changed:
   try:
    # Never leave unverified recording software armed in production.
    try:control("continuous_4k_trial","disable")
    except Exception:pass
    adb("shell","am","force-stop",PACKAGE,timeout=20)
    install(old);launch()
    restored=wait_health(False,seconds=135)
    print("S9_POSTMOTION_V7R2_ROLLBACK_CONFIRMED",json.dumps({"reason":str(error)[:240],
     "old_sha256":sha(old),"ready":healthy(restored)}),flush=True)
   except BaseException as secondary:
    print("S9_POSTMOTION_V7R2_ROLLBACK_FAILED",str(secondary)[:400],flush=True)
  raise
if __name__=="__main__":main()
