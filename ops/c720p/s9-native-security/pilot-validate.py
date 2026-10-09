#!/usr/bin/env python3
"""One-shot SD camera pilot. Existing security remains primary; always restore IP Webcam."""
import json,subprocess as sp,time,urllib.request,sys
PHONE="192.168.178.250:5555"
IPW="http://192.168.178.250:8080"
NATIVE="http://127.0.0.1:18808"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
def get(url,timeout=5):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def adb(*args,timeout=16,check=True):
 p=sp.run(["adb","-s",PHONE,*args],text=True,capture_output=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError("ADB_"+p.stderr[-180:])
 return p.stdout.strip()
def rest():
 try:adb("shell","am","start-foreground-service","-n","nl.kalenel.s9security/.CameraService","-a","STOP",timeout=14,check=False)
 except Exception:pass
 for i in range(8):
  try:
   if get(IPW+"/status.json",timeout=3).get("curvals"):print("IP_WEBCAM_RESTORED",flush=True);break
  except Exception:pass
  if i==2:
   try:adb("shell","am","broadcast","-a","com.pas.webcam.CONTROL","-e","action","start",timeout=12,check=False)
   except Exception:pass
  time.sleep(2)
def main():
 sp.run(["adb","connect",PHONE],capture_output=True,timeout=12)
 h=get("http://127.0.0.1:8793/health.json")
 e=get("http://127.0.0.1:18798/status")
 if not h.get("camera_ok") or h.get("recording") or e.get("recording_in_progress") or e.get("recording_orphan_present"):
  print("DEFER_SECURITY_RECORDING_ACTIVE");return
 if float(e.get("temperature_c") or 50)>=39:print("DEFER_THERMAL");return
 if not get(IPW+"/status.json").get("curvals"):raise RuntimeError("existing_camera_not_healthy")
 try:
  print("START_NATIVE_CAMERASAFE_PILOT",flush=True)
  adb("shell","am","start","-n","nl.kalenel.s9security/.CameraActivity",
    "--ez","enable_native_camera","true","--ez","pilot_only","true",timeout=20)
  adb("forward","tcp:18808","tcp:8808",timeout=10)
  last=None;history=[]
  end=time.monotonic()+75
  while time.monotonic()<end:
   try:
    last=get(NATIVE,timeout=4)
    cur=(last.get("mode"),last.get("recorded"),last.get("reviewed"),last.get("last_error"))
    if not history or history[-1]!=cur:history.append(cur)
    if last.get("recorded",0)>0 and last.get("reviewed",0)>0:break
    if last.get("mode")=="stopped" and last.get("last_error"):break
   except Exception:pass
   time.sleep(3)
  print("PILOT_STATUS_HISTORY",history,flush=True)
  if last is None:raise RuntimeError("no_native_camera_status")
  print("PILOT_FINAL_STATUS",last,flush=True)
  if last.get("recorded",0)<1:raise RuntimeError("no_4k_pilot_recording")
  clip=last.get("last_file")
  if not clip or not clip.startswith("motion_"):raise RuntimeError("no_verified_pilot_name")
  manifest=json.loads(adb("exec-out","cat",SD+"/"+clip+".verified.json",timeout=30))
  print("PILOT_CLIP_METADATA",manifest,flush=True)
  if manifest.get("width")!=3840 or manifest.get("height")!=2160 or not manifest.get("sha256") or manifest.get("bytes",0)<500000:
   raise RuntimeError("4k_output_not_verified")
  print("S9_NATIVE_SECURITY_DUAL_STREAM_MOTION_AND_REVIEW_PASS",flush=True)
 finally:rest()
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("NATIVE_SECURITY_PILOT_ERROR",type(e).__name__,str(e)[:250],file=sys.stderr)
  rest()
  sys.exit(1)
