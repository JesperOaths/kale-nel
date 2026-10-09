#!/usr/bin/env python3
"""Non-destructive 4K encoder test after IP Webcam app's documented restart broadcast."""
import json,time,datetime,subprocess as sp,urllib.request,urllib.parse,shutil
from pathlib import Path
IP="http://192.168.178.250:8080"
HUB="http://127.0.0.1:8793"
CFG=Path("/home/jespern/c720p-security-camera-new/frontyard-security-config.json")
ADB="192.168.178.250:5555"
def get(url,timeout=7):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def cmd(*args,timeout=22):
 p=sp.run(["adb","-s",ADB,*args],text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("ADB:"+p.stderr[-200:])
 return p.stdout
def broadcast(action):
 return cmd("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action",action,timeout=17)
def online(limit=28):
 for i in range(limit):
  try:
   s=get(IP+"/status.json",3)
   if s.get("curvals"):return s
  except Exception:pass
  time.sleep(1)
 raise RuntimeError("webcam_did_not_restart")
def setvideo(v):
 with urllib.request.urlopen(IP+"/settings/video_size?set="+urllib.parse.quote(v),timeout=9) as x:x.read()
def restart():
 print("BROADCAST_STOP",broadcast("stop")[-160:],flush=True)
 time.sleep(2)
 print("BROADCAST_START",broadcast("start")[-160:],flush=True)
 return online()
def readsize(name):
 p=sp.run(["ffprobe","-v","error","-show_entries","stream=codec_name,width,height","-of","json",IP+"/v/"+name],text=True,capture_output=True,timeout=40)
 if p.returncode:raise RuntimeError("ffprobe_failed")
 d=json.loads(p.stdout)
 return [(v.get("width"),v.get("height"),v.get("codec_name")) for v in d["streams"] if v.get("width")]
def main():
 sp.run(["adb","connect",ADB],capture_output=True,timeout=12)
 old=get(IP+"/status.json")
 h=get(HUB+"/health.json")
 if old.get("video_status",{}).get("enabled") or h.get("recording"):
  print("4K_TEST_DEFER_ACTIVE_RECORDING");return
 assert old.get("curvals",{}).get("video_size")=="1920x1080","unexpected recording baseline"
 cfg=json.loads(CFG.read_text())
 backup=CFG.with_name(CFG.name+".before-native-4k-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
 shutil.copy2(CFG,backup)
 started=False
 try:
  cfg["camera_video_size"]="3840x2160"
  cfg.setdefault("battery_profile_normal",{})["video_size"]="3840x2160"
  CFG.write_text(json.dumps(cfg,indent=2)+"\n")
  setvideo("3840x2160")
  status=restart()
  print("AFTER_4K_RESTART",status.get("curvals",{}).get("video_size"),flush=True)
  assert status.get("curvals",{}).get("video_size")=="3840x2160","4k setting not retained"
  records={x["name"] for x in get(IP+"/list_videos")}
  out=get(IP+"/startvideo")
  if out.get("result")!="started":raise RuntimeError("startvideo_refused")
  started=True
  name=out.get("fname")
  time.sleep(9)
  stopped=get(IP+"/stopvideo")
  started=False
  print("4K_STOP",stopped,flush=True)
  assert stopped.get("result")=="stopped","stopvideo failed"
  listing={x["name"] for x in get(IP+"/list_videos")}
  assert name in listing and name not in records,"test file not created"
  print("ENCODED_MEDIA",name,readsize(name),flush=True)
 finally:
  if started:
   try:get(IP+"/stopvideo")
   except Exception:pass
  shutil.copy2(backup,CFG)
  try:
   setvideo("1920x1080")
   restored=restart()
   print("RESTORED_PROFILE",restored.get("curvals",{}).get("video_size"),flush=True)
  except Exception as e:
   print("RESTORE_ERROR",repr(e),flush=True)
   try:print("EMERGENCY_RESTART",broadcast("start"))
   except Exception:pass
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("4K_TEST_UNSUCCESSFUL",type(e).__name__,str(e)[:240])
  raise
