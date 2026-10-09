#!/usr/bin/env python3
"""Safe temporary 4K IP Webcam recording probe. Always restore original video size."""
import json,subprocess,time,urllib.request,urllib.parse,sys
CONTROL="http://127.0.0.1:8793"
PHONE="http://192.168.178.250:8080"
def jsonget(url,timeout=8):
 with urllib.request.urlopen(url,timeout=timeout) as r:return json.load(r)
def set_video(value):
 data=json.dumps({"key":"video_size","value":value}).encode()
 req=urllib.request.Request(CONTROL+"/camera-control",data=data,
  headers={"Content-Type":"application/json"},method="POST")
 with urllib.request.urlopen(req,timeout=14) as r:return json.load(r)
def current_video():
 d=jsonget(CONTROL+"/camera-controls")
 return str((d.get("controls") or {}).get("video_size",{}).get("value") or "")
def main():
 old=current_video()
 print("BEFORE_VIDEO_SIZE",old,flush=True)
 if old!="1920x1080":raise RuntimeError("unexpected_live_profile_aborting")
 st=jsonget(PHONE+"/status.json")
 if (st.get("video_status") or {}).get("enabled"):raise RuntimeError("already_recording")
 src_before={x.get("name") for x in jsonget(PHONE+"/list_videos")}
 started=False
 try:
  changed=set_video("3840x2160")
  print("SET_4K",changed,flush=True)
  if not changed.get("ok"):raise RuntimeError("4k_setting_not_applied")
  time.sleep(4)
  read=current_video()
  print("ACTIVE_4K",read,flush=True)
  if read!="3840x2160":raise RuntimeError("4k_not_confirmed")
  phone=jsonget(PHONE+"/status.json")
  if (phone.get("video_status") or {}).get("enabled"):raise RuntimeError("unexpected_recording_active")
  response=jsonget(PHONE+"/startvideo")
  print("TEST_START",response,flush=True)
  if response.get("result")!="started":raise RuntimeError("native_recorder_refused")
  started=True
  time.sleep(9)
 finally:
  if started:
   try:print("TEST_STOP",jsonget(PHONE+"/stopvideo"),flush=True)
   except Exception as e:print("STOP_FAILED",type(e).__name__,flush=True)
  try:print("RESTORE",set_video(old),flush=True)
  except Exception as e:print("RESTORE_FAILED",type(e).__name__,str(e)[:120],flush=True)
  time.sleep(3)
  print("AFTER_VIDEO_SIZE",current_video(),flush=True)
 files=jsonget(PHONE+"/list_videos")
 added=[x for x in files if x.get("name") not in src_before]
 print("NEW_FILES",[(x.get("name"),x.get("size")) for x in added],flush=True)
 for row in added[:2]:
  name=str(row.get("name") or "")
  if not name.startswith("rec_") or not name.endswith(".mp4"):continue
  url=PHONE+"/v/"+urllib.parse.quote(name)
  result=subprocess.run(["ffprobe","-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height,codec_name,r_frame_rate,bit_rate",
    "-of","json",url],capture_output=True,text=True,timeout=30)
  print("MP4_DIMENSIONS",name,result.stdout[:900],result.stderr[:250],flush=True)
 print("S9_4K_PILOT_DONE",flush=True)
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("S9_4K_PILOT_FAILED",type(e).__name__,str(e)[:160],file=sys.stderr);sys.exit(1)
