#!/usr/bin/env python3
"""Replace native camera APK only between clips; restore previous APK on failure."""
import json,pathlib,subprocess,time,urllib.request,sys,datetime
P="192.168.178.250:5555"
APK=pathlib.Path("/home/jespern/c720p-home-hub/build/s9-native-security/s9-native-security.apk")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/native-security-cutover")
BACK.mkdir(parents=True,exist_ok=True)
FLAG=pathlib.Path("/home/jespern/c720p-home-hub/state/s9-native-security-active.flag")
def do(a,timeout=35,check=True):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError("FAILED "+str(a[:3])+" "+p.stderr[-150:])
 return p.stdout.strip()
def adb(*args,timeout=30,check=True):return do(["adb","-s",P,*args],timeout,check)
def get(url):
 with urllib.request.urlopen(url,timeout=7) as r:return json.load(r)
def healthy(target):
 try:
  n=get("http://127.0.0.1:18808/status")
  if not n.get("native_4k_enabled") or not n.get("ok") or not n.get("snapshot_ready"):
   return False,n
  if target and n.get("recording_rate_max_per_hour")!=12:return False,n
  return n.get("mode") in ("watching","recording","starting"),n
 except Exception:return False,{}
def launch():
 adb("shell","am","force-stop","nl.kalenel.s9security",timeout=12,check=False)
 adb("shell","am","start","-n","nl.kalenel.s9security/.CameraActivity",
     "--ez","enable_native_camera","true",timeout=24)
def wait_healthy(rate,max_wait=48):
 until=time.monotonic()+max_wait
 last={}
 while time.monotonic()<until:
  ok,last=healthy(rate)
  if ok and int(last.get("frames") or 0)>=20:return last
  time.sleep(2)
 raise RuntimeError("native_app_post_install_not_healthy_"+str(last.get("last_error")))
def main():
 if not FLAG.exists():raise RuntimeError("native_cutover_flag_missing")
 if APK.stat().st_size<1000000:raise RuntimeError("new_apk_missing")
 sd=adb("shell","df","-h","/storage/9C33-6BBD")
 if "/storage/9C33-6BBD" not in sd:raise RuntimeError("microSD_not_mounted")
 try:
  home=get("http://127.0.0.1:8793/health.json")
  if not home.get("camera_ok") or home.get("recording"):
   raise RuntimeError("hub_native_camera_not_ready")
 except Exception as e:raise
 dest=BACK/("S9-native-before-night-guard-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S")+".apk")
 app=adb("shell","pm","path","nl.kalenel.s9security").splitlines()
 paths=[x.split("package:",1)[1].strip() for x in app if x.startswith("package:")]
 if not paths:raise RuntimeError("cannot_backup_current_install")
 adb("pull",paths[0],str(dest),timeout=40)
 if dest.stat().st_size<1000000:raise RuntimeError("rollback_apk_invalid")
 print("ROLLBACK_APK_SAVED",dest,flush=True)
 end=time.monotonic()+130
 seen=0
 while time.monotonic()<end:
  try:
   n=get("http://127.0.0.1:18808/status")
   if n.get("mode")=="watching" and n.get("ok"):
    seen+=1
    if seen>=2:break
   else:seen=0
  except Exception:seen=0
  time.sleep(2)
 else:raise RuntimeError("no_safe_idle_window")
 print("CAMERA_IDLE_UPGRADE",n.get("recorded"),n.get("reviewed"),flush=True)
 stopped=False
 try:
  adb("shell","am","force-stop","nl.kalenel.s9security",timeout=13)
  stopped=True
  result=adb("install","-r","-g",str(APK),timeout=110)
  print("INSTALL",result[-400:],flush=True)
  launch()
  n=wait_healthy(rate=True,max_wait=52)
  h=get("http://127.0.0.1:8793/health.json")
  if not h.get("camera_ok") or h.get("last_motion_source")!="s9-native-camera2-on-phone":
   raise RuntimeError("Home_native_feed_not_healthy")
  print("NATIVE_NIGHT_GUARD_ACTIVE",json.dumps({"frames":n.get("frames"),"mode":n.get("mode"),
    "max_per_hour":n.get("recording_rate_max_per_hour"),"SD_free":n.get("sd_free_bytes"),
    "temperature":n.get("temperature_c"),"scene_source":h.get("last_motion_source")}),flush=True)
 except Exception as error:
  print("NATIVE_APK_UPGRADE_ROLLBACK",type(error).__name__,str(error)[:180],flush=True)
  if stopped:
   try:
    adb("shell","am","force-stop","nl.kalenel.s9security",timeout=13,check=False)
    adb("install","-r","-g",str(dest),timeout=110)
    launch()
    wait_healthy(rate=False,max_wait=50)
    print("OLD_NATIVE_APK_RESTORED",flush=True)
   except Exception as x:print("RESTORE_FAILED",str(x)[:200],flush=True)
  raise
if __name__=="__main__":main()
