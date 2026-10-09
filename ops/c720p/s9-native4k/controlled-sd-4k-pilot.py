#!/usr/bin/env python3
"""Bounded native S9+ 4K pilot, emergency-restores IP Webcam + ADB forwards."""
import json,subprocess as sp,time,urllib.request,datetime,sys
PHONE="192.168.178.250:5555"
IPW="http://192.168.178.250:8080"
HUB="http://127.0.0.1:8793"
EDGE="http://127.0.0.1:18798"
NAT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9nativefourk/files/Native4K"
def adb(*args,timeout=15,check=True):
 p=sp.run(["adb","-s",PHONE,*args],capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError("ADB: "+p.stderr[-180:])
 return p.stdout.strip()
def get(url,timeout=8):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def rest():
 sp.run(["adb","connect",PHONE],capture_output=True,timeout=15)
 try:
  print("RESTORE_IP_WEBCAM",adb("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action","start",timeout=12,check=False)[-160:],flush=True)
 except Exception as e:print("RESTORE_BROADCAST_ERROR",repr(e),flush=True)
 for i in range(22):
  try:
   if get(IPW+"/status.json",timeout=3).get("curvals"):break
  except Exception:pass
  time.sleep(1)
 for p,t in (("18798","8798"),("18799","8799")):
  try:adb("forward","tcp:"+p,"tcp:"+t,timeout=8,check=False)
  except Exception:pass
 try:
  h=get(HUB+"/health.json")
  print("RESTORED_CAMERA_HEALTH",h.get("camera_ok"),flush=True)
 except Exception as e:print("RESTORE_HEALTH_MISSING",repr(e),flush=True)
def main():
 sp.run(["adb","connect",PHONE],capture_output=True,timeout=15)
 if not get(HUB+"/health.json").get("camera_ok"):raise RuntimeError("C720P camera unhealthy")
 if get(HUB+"/health.json").get("recording"):raise RuntimeError("C720P recorder busy")
 if get(IPW+"/status.json").get("video_status",{}).get("enabled"):raise RuntimeError("IP Webcam currently recording")
 edge=get(EDGE)
 if not edge.get("recording_enabled") or edge.get("recording_in_progress"):raise RuntimeError("S9 recorder busy")
 temp=float(edge.get("temperature_c") or 40)
 if temp>=39:raise RuntimeError("temperature too high")
 existing=adb("shell","ls","-1",NAT,check=False)
 assert "native4k-test-result.json" not in existing or existing is not None
 print("4K_PILOT_GO",{"temperature":temp,"old_SD_files":len(existing.splitlines())},flush=True)
 try:
  print("IP_WEBCAM_STOP",adb("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action","stop",timeout=12),flush=True)
  time.sleep(4)
  print("NATIVE_4K_START",adb("shell","am","start","-n","nl.kalenel.s9nativefourk/.CameraActivity","--ez","start_test","true","--ei","seconds","8",timeout=12),flush=True)
  time.sleep(15)
  manifest=adb("exec-out","cat",NAT+"/native4k-test-result.json",timeout=20)
  data=json.loads(manifest)
  print("NATIVE_4K_RESULT",data,flush=True)
  if data.get("status")!="VERIFIED_4K" or data.get("width")!=3840 or data.get("height")!=2160:
   raise RuntimeError("Native 4K not verified in metadata")
 finally:
  rest()
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("NATIVE_4K_PILOT_FAILURE",type(e).__name__,str(e)[:240],file=sys.stderr)
  try:rest()
  except Exception as r:print("EMERGENCY_RESTORE_FAILED",repr(r),file=sys.stderr)
  sys.exit(1)
