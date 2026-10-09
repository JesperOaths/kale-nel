#!/usr/bin/env python3
"""Run native S9 4K pilot in a safe idle window. Do not interrupt security events."""
import json,subprocess as sp,time,urllib.request,sys
P="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9nativefourk/files/Native4K/native4k-test-result.json"
def get(url,timeout=5):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def adb(*args,timeout=18):
 x=sp.run(["adb","-s",P,*args],capture_output=True,text=True,timeout=timeout)
 if x.returncode:raise RuntimeError("ADB_failed:"+x.stderr[-200:])
 return x.stdout
def rest():
 try:
  get("http://192.168.178.250:8080/status.json",timeout=5)
  print("IP_WEBCAM_RESTORED",flush=True)
 except Exception:
  try:
   print("IP_WEBCAM_RECOVERY",adb("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action","start",timeout=18)[-200:],flush=True)
  except Exception as e:print("IP_WEBCAM_RECOVERY_ERROR",repr(e),flush=True)
def main():
 sp.run(["adb","connect",P],capture_output=True,timeout=13)
 until=time.monotonic()+115; last=None
 while time.monotonic()<until:
  try:
   h=get("http://127.0.0.1:8793/health.json")
   e=get("http://127.0.0.1:18798/status")
   w=get("http://192.168.178.250:8080/status.json")
   idle=bool(h.get("camera_ok") and e.get("ok") and e.get("recording_enabled") and not h.get("recording")
      and not e.get("recording_in_progress") and not e.get("recording_orphan_present")
      and not w.get("video_status",{}).get("enabled") and float(e.get("temperature_c") or 50)<39)
   if idle:
    if last is None:last=time.monotonic()
    if time.monotonic()-last>=5:break
   else:last=None
  except Exception:last=None
  time.sleep(3)
 else:
  print("DEFER_NATIVE_4K_RECORDING_BUSY");return
 print("CAMERA_IDLE_NATIVE_4K_TEST_START",flush=True)
 try:
  out=adb("shell","am","start","-n","nl.kalenel.s9nativefourk/.CameraActivity","--ez","start_test","true","--ei","seconds","8",timeout=20)
  print("STARTED_NATIVE_ACTIVITY",out[-400:],flush=True)
  time.sleep(21)
  result=json.loads(adb("exec-out","cat",SD,timeout=22))
  print("NATIVE_TEST_MANIFEST",result,flush=True)
  if result.get("status")!="VERIFIED_4K":raise RuntimeError("not_genuine_4k_output")
 finally:
  rest()
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("NATIVE_IDLE_TEST_FAILED",type(e).__name__,str(e)[:220],file=sys.stderr)
  rest()
  sys.exit(1)
