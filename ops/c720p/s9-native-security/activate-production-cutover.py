#!/usr/bin/env python3
"""Reversible S9 4K native security cutover. No SD deletion or cloud uploads."""
import datetime as dt,json,os,pathlib,subprocess,time,urllib.request,sys
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
CFG=pathlib.Path("/home/jespern/c720p-security-camera-new/frontyard-security-config.json")
FLAG=BASE/"state/s9-native-security-active.flag"
REPORT=BASE/"state/s9-native-security-cutover.json"
ADDR="192.168.178.250:5555"
TIMERS=[
 "c720p-s9-battery-camera-gate.timer",
 "c720p-newcam-lowlight-guard.timer",
 "c720p-newcam-profile-guard.timer",
 "c720p-newcam-health-watchdog.timer",
 "c720p-newcam-app-persistence-guard.timer",
 "c720p-camera-twohour-live-failsafe.timer",
 "c720p-home-live-contract-guard.timer",
 "c720p-s9-staging-cleanup.timer",
]
def cmd(args,timeout=35,check=True):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:
  raise RuntimeError("command_failed "+str(args[:3])+" "+p.stderr[-220:])
 return p.stdout.strip()
def adb(*args,timeout=22,check=True):
 return cmd(["adb","-s",ADDR,*args],timeout,check)
def get(url,timeout=5):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def atomic(obj):
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 temp=REPORT.with_suffix(".json.temp")
 temp.write_text(json.dumps(obj,indent=2)+"\n")
 os.replace(temp,REPORT)
def state(task):
 return cmd(["systemctl","--user","is-active",task],5,False)
def enabled(task):
 return cmd(["systemctl","--user","is-enabled",task],5,False)
def old_scene():
 return get("http://127.0.0.1:8793/health.json",timeout=7)
def old_phone():
 return get("http://127.0.0.1:18798/status",timeout=6)
def native():
 return get("http://127.0.0.1:18808/status",timeout=6)
def stop_new():
 try:adb("shell","am","start-foreground-service","-n","nl.kalenel.s9security/.CameraService","-a","STOP",timeout=15,check=False)
 except Exception:pass
def restore(old,timers,reason):
 print("ROLLBACK_BEGIN",reason,flush=True)
 try:FLAG.unlink(missing_ok=True)
 except Exception:pass
 stop_new()
 try:
  adb("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action","start",timeout=14,check=False)
 except Exception:pass
 if old is not None:
  try:CFG.write_text(json.dumps(old,indent=2)+"\n")
  except Exception:pass
 for unit,status in timers.items():
  if status in ("enabled","enabled-runtime","linked"):
   try:cmd(["systemctl","--user","enable","--now",unit],timeout=12,check=False)
   except Exception:pass
 for activity in ["nl.kalenel.s9edge/.EdgeActivity","nl.kalenel.s9person/.PersonActivity"]:
  try:adb("shell","am","start","-n",activity,timeout=13,check=False)
  except Exception:pass
 for unit in ["c720p-frontyard-security-new.service","c720p-lan-camera-relay.service"]:
  try:cmd(["systemctl","--user","restart",unit],timeout=22,check=False)
  except Exception:pass
 print("ROLLBACK_ATTEMPT_COMPLETE",flush=True)
def live_check(url):
 with urllib.request.urlopen(url,timeout=12) as r:
  if r.status!=200 or "multipart" not in r.headers.get("Content-Type",""):
   raise RuntimeError("MJPEG_health_status_incorrect")
  x=r.read(3072)
  if not x.startswith(b"--") or b"\xff\xd8" not in x:
   raise RuntimeError("MJPEG_frame_not_confirmed")
 return True
def main():
 saved=None;prior={};changes=False
 report={"started":dt.datetime.now().astimezone().isoformat(),"stage":"preflight"}
 atomic(report)
 try:
  cmd(["adb","connect",ADDR],timeout=15)
  before=old_scene();edge=old_phone()
  if not before.get("camera_ok") or before.get("recording"):
   raise RuntimeError("legacy_camera_currently_recording_or_unhealthy")
  if not edge.get("ok") or edge.get("recording_in_progress") or edge.get("recording_orphan_present"):
   raise RuntimeError("legacy_SD_recorder_busy_or_unhealthy")
  if float(edge.get("temperature_c") or 45)>38.5:
   raise RuntimeError("thermal_headroom_insufficient")
  if not get("http://192.168.178.250:8080/status.json",timeout=7).get("curvals"):
   raise RuntimeError("no_live_fallback_camera")
  adb("forward","tcp:18808","tcp:8808",timeout=12)
  sd=adb("shell","df","-k","/storage/9C33-6BBD",timeout=15)
  print("PRE_CUTOVER_SD",sd,flush=True)
  if "9C33-6BBD" not in sd:raise RuntimeError("removable_SD_not_mounted")
  saved=json.loads(CFG.read_text())
  if saved.get("motion_mode")!="s9_ml_edge":
   print("PREVIOUS_MOTION_MODE",saved.get("motion_mode"))
  if saved.get("motion_mode")=="s9_native_phone":
   raise RuntimeError("already_in_native_mode")
  if FLAG.exists():raise RuntimeError("stale_native_flag_present")
  if "S9_NATIVE_SECURITY_CUTOVER_V1" not in pathlib.Path(
      "/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py").read_text():
   raise RuntimeError("missing_native_hub_hook")
  if "S9_NATIVE_SECURITY_RELAY_V1" not in pathlib.Path(
      "/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py").read_text():
   raise RuntimeError("missing_native_live_relay_hook")
  for unit in TIMERS:prior[unit]=enabled(unit)
  stamp=dt.datetime.now().strftime("%Y%m%d-%H%M%S")
  backup=CFG.with_name(CFG.name+".before-native-cutover-"+stamp)
  backup.write_text(CFG.read_text())
  report.update(stage="guards_stopped",backup=str(backup),timer_prior=prior)
  atomic(report)
  # Stop legacy camera guardians so they cannot seize the Android camera mid-takeover.
  for unit in TIMERS:
   if state(unit)!="inactive" or enabled(unit) in ("enabled","enabled-runtime"):
    cmd(["systemctl","--user","disable","--now",unit],timeout=16,check=False)
  changes=True
  print("LEGACY_CAMERA_GUARDS_PAUSED",flush=True)
  # Activity passes takeover_ipwebcam=true for production and stops IPW on phone.
  adb("shell","am","force-stop","nl.kalenel.s9security",timeout=12)
  adb("shell","am","start","-n","nl.kalenel.s9security/.CameraActivity",
      "--ez","enable_native_camera","true",timeout=22)
  end=time.monotonic()+42
  initial=None;successful=0
  while time.monotonic()<end:
   try:
    n=native()
    if n.get("ok") and not n.get("pilot_only") and n.get("native_4k_enabled") and n.get("snapshot_ready") and n.get("mode") in ("watching","recording","starting") and float(n.get("temperature_c") or 50)<40:
     if initial is None:initial=int(n.get("frames",0))
     if int(n.get("frames",0))>initial+10:
      successful+=1
      if successful>=2:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError("native_app_failed_live_4k_yuv_health")
  print("NATIVE_CAMERA_OWNS_PREVIEW",n.get("frames"),n.get("mode"),flush=True)
  with urllib.request.urlopen("http://127.0.0.1:18808/shot.jpg",timeout=8) as p:
   jpg=p.read(750000)
  if not jpg.startswith(b"\xff\xd8\xff") or len(jpg)<4000:
   raise RuntimeError("native_camera_JPEG_failed")
  # Hub config first, then authenticated UI route via flag; do not delete old evidence.
  cfg=dict(saved);cfg["motion_mode"]="s9_native_phone"
  tmp=CFG.with_suffix(".json.native-tmp");tmp.write_text(json.dumps(cfg,indent=2)+"\n")
  os.replace(tmp,CFG)
  FLAG.parent.mkdir(parents=True,exist_ok=True)
  FLAG.write_text("enabled "+stamp+"\n")
  cmd(["systemctl","--user","restart","c720p-lan-camera-relay.service"],timeout=32)
  cmd(["systemctl","--user","restart","c720p-frontyard-security-new.service"],timeout=35)
  if not live_check("http://127.0.0.1:8794/new/live.mjpg"):
   raise RuntimeError("Home_live_MJPEG_failed")
  api=get("http://127.0.0.1:8794/new/api/saved",timeout=10)
  if not api.get("ok") or len(api.get("events",[]))<12:
   raise RuntimeError("SD_recordings_not_available_after_cutover")
  h=old_scene()
  if h.get("recording") or h.get("last_motion_source") not in (
     "s9-native-camera2-on-phone","s9-native-phone-unreachable"):
   # Non-triggering hub and correct source are essential to avoid duplicate clips.
   raise RuntimeError("hub_native_ownership_not_confirmed_"+str(h.get("last_motion_source")))
  report.update(stage="native_4k_active",
                clips=len(api.get("events",[])),native_status=n,
                home_camera_ok=h.get("camera_ok"),home_motion_source=h.get("last_motion_source"),
                completed=dt.datetime.now().astimezone().isoformat())
  atomic(report)
  print("NATIVE_4K_PRODUCTION_CUTOVER_VERIFIED",json.dumps({"clips":report["clips"],
        "native_frames":n.get("frames"),"source":h.get("last_motion_source")}),flush=True)
  # Historical edge/person processes are stopped, never uninstalled: their SD archives remain.
  for pkg in ("nl.kalenel.s9edge","nl.kalenel.s9person"):
   adb("shell","am","force-stop",pkg,timeout=13,check=False)
  print("OLD_ML_RECORDERS_QUIESCED_IP_WEBCAM_NO_LONGER_CAMERA",flush=True)
 except Exception as e:
  report["stage"]="cutover_failed";report["error"]=type(e).__name__+":"+str(e)[:240]
  atomic(report)
  if changes:restore(saved,prior,report["error"])
  raise
if __name__=="__main__":main()
