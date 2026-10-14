#!/usr/bin/env python3
"""Deploy the v7 30-second post-motion tail on the already verified S9+ 4K APK.

Preserves signed v6 APK for rollback. Only activates after camera idle, stable
GPU/4K ring, and enough space; then proves a real ~39-second single 4K MP4
(7-9s pre-event + >=30s post-event), packet continuity and app-restart
persistence. Diagnostic media is never indexed as a security event.
"""
from pathlib import Path
import datetime,hashlib,json,os,re,statistics,subprocess,tempfile,time,urllib.request,zipfile
HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-unified-4k-person-v11/release.json"
OUTPUT=HOME/"build/s9-unified-4k-person-v11/deployment-report.json"
BACK=HOME/"backups/s9-unified-4k-person-v11"
SERIAL="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
BASE="http://127.0.0.1:18808"
PHONE_DIR="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
V6_SHA="9b8ee341ce5db74f8fdffd293ff718068f8433b3423c9778f6886d7891c46b2e"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
VERSION="continuous_native_4k_h264_ring_v1"
SRC_SHA=os.environ.get("S9_UNIFIED_V11_REF","")

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
def safe_baseline(d):
 return (d.get("ok") is True and d.get("mode")=="watching" and
  d.get("garden_person_gate_backend")=="gpu" and
  d.get("native_4k_enabled") is True and
  d.get("sd_free_bytes",0)>15*1024**3 and
  d.get("last_frame_age_ms",99999)<1500 and
  d.get("temperature_c",100)<36.7)

def healthy(d,expect_tail=False,allow_trial=False):
 return (d.get("ok") is True and d.get("mode")=="watching" and
  d.get("native_4k_enabled") is True and
  d.get("garden_person_gate_backend")=="gpu" and
  (allow_trial or d.get("continuous_4k_production_persisted") is True) and
  d.get("continuous_4k_trial_active") is True and
  d.get("continuous_4k_ready") is True and
  d.get("continuous_4k_buffered_ms",0)>=4500 and
  d.get("continuous_4k_dropped_output_frames",1)==0 and
  not d.get("continuous_4k_error") and
  d.get("temperature_c",100)<38.5 and
  d.get("sd_free_bytes",0)>15*1024**3 and
  d.get("last_frame_age_ms",99999)<1500 and
  (not expect_tail or d.get("person_post_motion_hold_ms")==10000))
def wait_idle(hold=14,deadline=190,expect_tail=False,baseline=False,allow_trial=False):
 started=time.monotonic()
 stable=None
 while time.monotonic()-started<deadline:
  d=status()
  if d.get("temperature_c",100)>=38.5:
   raise RuntimeError("temperature_high_refuse_install_or_test")
  if (safe_baseline(d) if baseline else healthy(d,expect_tail,allow_trial)):
   count=d.get("recorded")
   if stable is None or stable[1]!=count:stable=(time.monotonic(),count)
   if time.monotonic()-stable[0]>=hold:return d
  else:stable=None
  time.sleep(2)
 raise RuntimeError("no_safe_4k_idle_window")
def wait_health(expect_tail,seconds=140,allow_trial=False):
 t=time.monotonic()
 while time.monotonic()-t<seconds:
  try:
   forward()
   d=status()
   if healthy(d,expect_tail,allow_trial):return d
  except Exception:pass
  time.sleep(2)
 raise RuntimeError("native_4k_camera_not_ready_after_install")
def wait_watching_after_launch(seconds=90):
 start=time.monotonic()
 while time.monotonic()-start<seconds:
  try:
   forward()
   d=status()
   if safe_baseline(d):return d
  except Exception:pass
  time.sleep(2)
 raise RuntimeError("camera_not_watching_after_install")
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
 with tempfile.TemporaryDirectory(prefix="s9-5s10s-v9-proof-",dir="/tmp") as folder:
  p=Path(folder)/name
  adb("pull",PHONE_DIR+"/"+name,str(p),timeout=190)
  if not p.is_file() or p.stat().st_size<15000000:raise RuntimeError("diagnostic_clip_missing")
  video,duration=video_properties(p)
  packets=frame_timing(p)
  if (video.get("codec_name"),video.get("width"),video.get("height"))!=("h264",3840,2160):
   raise RuntimeError("not_genuine_4k_video")
  if not 14<=duration<=23:
   raise RuntimeError("unified_v11_postmotion_duration_invalid_"+str(duration))
  if packets["frames"]<390 or packets["nonmonotonic"]>0 or packets["max_gap_s"]>0.12 or packets["keyframes"]<8:
   raise RuntimeError("4k_tail_timestamps_invalid_"+str(packets))
  for pos in ("0","4","8","12"):
   call(["ffmpeg","-nostdin","-hide_banner","-threads","1","-v","error",
    "-ss",pos,"-i",str(p),"-map","0:v:0","-frames:v","2","-f","null","-"],timeout=90)
  return {"clip":name,"duration_s":duration,"stream":video,"timing":packets,
   "bytes":p.stat().st_size,"sha256":sha(p),"decodes_at_s":[0,4,8,12]}
def save(data):
 OUTPUT.parent.mkdir(parents=True,exist_ok=True)
 p=OUTPUT.with_name(".deployment-report.tmp")
 p.write_text(json.dumps(data,sort_keys=True,indent=2)+"\n")
 os.replace(p,OUTPUT)
def main():
 m=json.loads(RELEASE.read_text());apk=Path(m["apk"])
 if m.get("source_sha")!=SRC_SHA or not m.get("signed") or sha(apk)!=m["sha256"] or not m.get("models_native_and_manifest_preserved"):
  raise RuntimeError("release_digest_or_source_contract_failed")
 if m.get("person_gate_version")!="person_spatiotemporal_transport_v9":
  raise RuntimeError("unified_release_person_gate_not_v9")
 if m.get("encoder_stop_clock")!="mediacodec_presentation_timestamp_v10":
  raise RuntimeError("regressed_encoder_pts_stop_clock")
 signer(apk)
 if not re.fullmatch(r"[0-9a-f]{40}",SRC_SHA):
  raise RuntimeError("immutable_source_sha_required")
 if os.statvfs(str(HOME)).f_bavail*os.statvfs(str(HOME)).f_frsize<250*1024**2:
  raise RuntimeError("c720p_disk_below_250MiB_safe_backup_floor")
 forward()
 before=wait_idle(hold=14,baseline=True)
 if before.get("preroll_version") not in (VERSION,
    "s9_on_phone_avc_memory_ring_keyframe_7s_v3"):
  raise RuntimeError("unrecognized_prior_ring_refuse_install")
 if before.get("temperature_c",100)>=36.7:
  print("S9_POSTMOTION_INSTALL_DEFERRED_TEMP",before.get("temperature_c"),flush=True)
  return
 oldpaths=adb("shell","pm","path",PACKAGE).splitlines()
 oldpaths=[row.split(":",1)[1] for row in oldpaths if row.startswith("package:") and row.endswith("base.apk")]
 if len(oldpaths)!=1:raise RuntimeError("ambiguous_installed_apk")
 BACK.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix="s9-installed-v6-hash-",dir="/tmp") as temp:
  local=Path(temp)/"installed.apk"
  adb("pull",oldpaths[0],str(local),timeout=130)
  if sha(local)!=V6_SHA:raise RuntimeError("installed_camera_apk_changed_refuse_install")
  with zipfile.ZipFile(local) as original,zipfile.ZipFile(apk) as upgrade:
   keys=lambda z: sorted(n for n in z.namelist() if n=="AndroidManifest.xml" or n.startswith(("assets/","lib/")))
   if keys(original)!=keys(upgrade):
    raise RuntimeError("installed_4k_assets_or_libraries_changed")
   for name in keys(original):
    if hashlib.sha256(original.read(name)).digest()!=hashlib.sha256(upgrade.read(name)).digest():
     raise RuntimeError("installed_apk_asset_mismatch_"+name)

 old=next((p for p in sorted(BACK.glob("before-unified-*.apk")) if sha(p)==V6_SHA),None)
 if old is None:
  old=BACK/("before-unified-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
  adb("pull",oldpaths[0],str(old),timeout=130)
 signer(old)
 if sha(old)!=V6_SHA:raise RuntimeError("baseline_backup_hash_mismatch")
 print("SIGNED_V6_ROLLBACK_PRESERVED",str(old),flush=True)
 changed=False
 diagnostic=""
 try:
  d=wait_idle(hold=12,baseline=True)
  if d.get("temperature_c",100)>=38.5:
   print("S9_POSTMOTION_INSTALL_DEFERRED_TEMP",d.get("temperature_c"),flush=True)
   return
  adb("shell","am","force-stop",PACKAGE,timeout=20)
  changed=True
  install(apk);launch()
  live=wait_watching_after_launch()
  if not live.get("continuous_4k_trial_active"):
   if live.get("temperature_c",100)>=37.5:
    raise RuntimeError("too_warm_to_enable_4k_trial")
   enabled=control("continuous_4k_trial","enable")
   print("V9_4K_TRIAL_ENABLE",json.dumps(enabled),flush=True)
   if not enabled.get("ok"):raise RuntimeError("explicit_4k_trial_enable_failed")
  got=wait_health(True,allow_trial=True)
  if got.get("motion_detector")!="person_spatiotemporal_transport_v9" or got.get("garden_person_requires_local_motion_or_spatial_translation") is not True:
   raise RuntimeError("compiled_person_v9_gate_not_running")
  if got.get("continuous_4k_buffered_ms",0)<4500:raise RuntimeError("not_ready_4k_buffer")
  print("V9_CAMERA_LIVE",json.dumps({k:got.get(k) for k in
   ("mode","continuous_4k_ready","continuous_4k_buffered_ms","person_post_motion_hold_ms",
    "temperature_c","garden_person_gate_backend")}),flush=True)
  # 40s of live full-resolution ring, independent GPU inference and heat safety.
  for i in range(5):
   time.sleep(8)
   d=status()
   if not healthy(d,True,allow_trial=True):raise RuntimeError("v9_4k_burnin_failed")
   print("V9_BURNIN",i,d.get("temperature_c"),d.get("continuous_4k_dropped_output_frames"),flush=True)
  d=wait_idle(hold=8,expect_tail=True,deadline=110,allow_trial=True)
  if d.get("temperature_c",100)>=38.5:raise RuntimeError("diagnostic_heat_guard")
  if d.get("preroll_diagnostic_used"):raise RuntimeError("diagnostic_already_used")
  requested=control("preroll_diagnostic","record_tail_once")
  if not requested.get("ok") or requested.get("requested_post_motion_hold_ms")!=10000:
   raise RuntimeError("tail_diagnostic_refused_"+str(requested))
  print("V9_REAL_10S_TAIL_REQUESTED",json.dumps(requested),flush=True)
  for _ in range(110):
   time.sleep(1)
   d=status()
   diagnostic=d.get("preroll_diagnostic_clip","")
   if re.fullmatch(r"diagnostic_preroll_[0-9]{13}\.mp4",diagnostic) and "single_native_4k_complete_" in d.get("preroll_diagnostic_result",""):
    break
   if d.get("temperature_c",100)>=38.5:raise RuntimeError("recording_thermal_safety_failure")
  else:raise RuntimeError("10_second_tail_diagnostic_not_finalized")
  sample=check_test_clip(diagnostic)
  print("REAL_4K_PRE5_POST10_MP4_VERIFIED",json.dumps(sample),flush=True)
  # Diagnostic is not surveillance footage. Preserve it until the independent
  # validation has succeeded; remove only this exact test file afterwards.
  adb("shell","rm","--",PHONE_DIR+"/"+diagnostic,timeout=25)
  diagnostic=""
  if not status().get("continuous_4k_production_persisted"):
   promoted=control("continuous_4k_trial","promote")
   print("V9_4K_TRIAL_PROMOTED",json.dumps(promoted),flush=True)
   if not promoted.get("ok") or not promoted.get("production_persisted"):
    raise RuntimeError("native_4k_production_promotion_failed")
  reboot=wait_idle(hold=14,expect_tail=True,deadline=150)
  if reboot.get("temperature_c",100)>=37.1:raise RuntimeError("not_cool_enough_for_restart")
  adb("shell","am","force-stop",PACKAGE,timeout=20)
  launch()
  after=wait_health(True,seconds=125)
  for i in range(6):
   time.sleep(5)
   after=status()
   if not healthy(after,True):raise RuntimeError("unified_4k_not_persistent_after_app_restart")
   if after.get("motion_detector")!="person_spatiotemporal_transport_v9" or after.get("garden_person_requires_local_motion_or_spatial_translation") is not True:
    raise RuntimeError("pedestrian_gate_v9_not_persistent_after_restart")
  report={"ok":True,"production_deployed":True,"new_apk":str(apk),
   "apk_sha256":sha(apk),"baseline_rollback":str(old),
   "source_sha":m["source_sha"],"post_motion_hold_ms":10000,
   "max_segment_ms":120000,"max_segment_continuation_enabled":True,
   "person_gate_version":"person_spatiotemporal_transport_v9",
   "encoder_stop_clock":"mediacodec_presentation_timestamp_v10",
   "person_transport_veto_totals":after.get("garden_person_transport_conflicts_total"),
   "real_video":sample,"post_boot_4k_buffered_ms":after["continuous_4k_buffered_ms"],
   "post_boot_gpu":after["garden_person_gate_backend"],
   "post_boot_temperature_c":after["temperature_c"],
   "other_video_footage_modified":False}
  save(report)
  print("S9_UNIFIED_4K_PERSON_V11_DEPLOYMENT_VERIFIED",json.dumps(report),flush=True)
 except BaseException as error:
  if changed:
   try:
    # Never leave unverified recording software armed in production.
    # Preserve the previously enabled production 4K ring configuration
    # when reinstalling the verified 5-second/10-second recording APK.
    adb("shell","am","force-stop",PACKAGE,timeout=20)
    install(old);launch()
    # v6 is a valid fallback even while its 4K encoder is thermally resting.
    restored=None
    for _ in range(65):
     try:
      snapshot=status()
      if safe_baseline(snapshot):restored=snapshot;break
     except Exception:pass
     time.sleep(2)
    if restored is None:raise RuntimeError("rollback_camera_not_restored")
    print("S9_5S10S_V9_ROLLBACK_CONFIRMED",json.dumps({"reason":str(error)[:240],
     "old_sha256":sha(old),"watching_gpu_ok":safe_baseline(restored)}),flush=True)
   except BaseException as secondary:
    print("S9_5S10S_V9_ROLLBACK_FAILED",str(secondary)[:400],flush=True)
  raise
if __name__=="__main__":main()
