#!/usr/bin/env python3
"""Independently validate one labelled S9 diagnostic 4K + pre-event H264 pair.

Requirements: current Camera2 signed production APK with one-shot
preroll_diagnostic control and healthy rolling buffer; C720P ADB to S9.
No simulated "person" detection, no public archive entry, no human action.
Test media is cleaned only after both files have been ffprobed and decoded.
"""
import json, pathlib, re, subprocess, tempfile, time, urllib.request

BASE="http://127.0.0.1:18808"
ADB=("adb","-s","192.168.178.250:5555")
PHONE_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
NAME=re.compile(r"diagnostic_preroll_[0-9]{13}[.]mp4")
def status():
 with urllib.request.urlopen(BASE+"/status",timeout=12) as r:return json.load(r)
def adb(*args,timeout=75):
 return subprocess.run([*ADB,*args],capture_output=True,text=True,timeout=timeout,check=True).stdout
def media(path):
 p=subprocess.run(["ffprobe","-v","error","-show_entries",
   "stream=codec_name,width,height,r_frame_rate,avg_frame_rate:format=duration,size",
   "-of","json",str(path)],capture_output=True,text=True,timeout=18,check=True)
 value=json.loads(p.stdout);v=next((x for x in value.get("streams",[]) if x.get("codec_name") in ("h264","hevc")),None)
 if v is None:raise RuntimeError("no_video_stream_"+path.name)
 duration=float(value["format"]["duration"])
 if duration<=.5:raise RuntimeError("invalid_video_duration_"+path.name)
 return {"width":int(v["width"]),"height":int(v["height"]),
   "codec":v["codec_name"],"fps":v.get("avg_frame_rate"),
   "duration":round(duration,2),"bytes":int(value["format"]["size"])}
def decode(path):
 p=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-threads","1","-v","error",
    "-i",str(path),"-map","0:v:0","-frames:v","2","-f","null","-"],
    capture_output=True,text=True,timeout=36)
 if p.returncode:raise RuntimeError("media_decode_failed_"+path.name+":"+p.stderr[-160:])
def main():
 before=status()
 assert before.get("ok") and before.get("mode")=="watching" and before.get("native_4k_enabled")
 assert before.get("preroll_enabled") and before.get("preroll_ready")
 assert before.get("preroll_version")=="s9_on_phone_avc_memory_ring_keyframe_7s_v3"
 assert int(before.get("preroll_buffered_ms") or 0)>=7800
 assert not before.get("preroll_diagnostic_used")
 data=json.dumps({"key":"preroll_diagnostic","value":"record_once"},separators=(",",":")).encode()
 req=urllib.request.Request(BASE+"/control",data=data,headers={"Content-Type":"application/json"},method="POST")
 with urllib.request.urlopen(req,timeout=10) as r:ack=json.load(r)
 if not ack.get("ok") or not ack.get("excluded_from_security_archive"):raise RuntimeError("diagnostic_request_rejected")
 clip=""
 for step in range(34):
  time.sleep(1)
  live=status()
  clip=str(live.get("preroll_diagnostic_clip") or "")
  if NAME.fullmatch(clip) and live.get("preroll_last_name")==clip+".preroll.mp4":
   break
  if live.get("preroll_last_error"):
   raise RuntimeError("preroll_muxer_error_"+str(live.get("preroll_last_error")))
 else:
  raise RuntimeError("complete_diagnostic_pair_not_available_"+str(live.get("preroll_diagnostic_result")))
 if not live.get("ok") or live.get("mode") not in ("watching","configuring_preview"):
  raise RuntimeError("camera_unhealthy_after_diagnostic")
 if not 5500<=int(live.get("preroll_last_duration_ms") or 0)<=9000:
  raise RuntimeError("invalid_on_phone_buffer_duration")
 video=clip;preroll=clip+".preroll.mp4"
 for name in (video,preroll):
  if not re.fullmatch(r"diagnostic_preroll_[0-9]{13}[.]mp4(?:[.]preroll[.]mp4)?",name):
   raise RuntimeError("invalid_generated_name")
 with tempfile.TemporaryDirectory(prefix="s9-preroll-evidence-") as tmp:
  paths={}
  for name in (video,preroll):
   path=pathlib.Path(tmp)/name
   adb("pull",PHONE_ROOT+"/"+name,str(path),timeout=90)
   if not path.is_file() or path.stat().st_size<10000:raise RuntimeError("clip_download_incomplete_"+name)
   paths[name]=path
  original_info=media(paths[video]);buffer_info=media(paths[preroll])
  if (original_info["width"],original_info["height"])!=(3840,2160):
   raise RuntimeError("original_4k_mismatch")
  if (buffer_info["width"],buffer_info["height"])!=(640,480):
   raise RuntimeError("preroll_dimensions_mismatch")
  if original_info["duration"]<6 or not 5.5<=buffer_info["duration"]<=9.3:
   raise RuntimeError("invalid_original_or_preroll_timing")
  decode(paths[video]);decode(paths[preroll])
  report={"test":"S9_VERIFIED_4K_PLUS_KEYFRAME_ALIGNED_7S_PREROLL_V3","original":original_info,
    "preroll":buffer_info,"ram_buffer_duration_before_trigger_ms":before.get("preroll_buffered_ms"),
    "on_phone_preroll_duration_ms":live.get("preroll_last_duration_ms"),
    "camera_healthy":live.get("ok"),"post_test_mode":live.get("mode"),
    "diagnostic_only":True,"person_detection_claimed":False}
  # Only these two validated diagnostic files: never delete motion_*.mp4,
  # face images, metadata, thumbnails or any archive original.
  adb("shell","rm","--",PHONE_ROOT+"/"+video,PHONE_ROOT+"/"+preroll,timeout=12)
  report["diagnostic_media_cleaned"]=True
  print("S9_PREROLL_PAIR_INDEPENDENTLY_VALIDATED",json.dumps(report,sort_keys=True),flush=True)
if __name__=="__main__":main()
