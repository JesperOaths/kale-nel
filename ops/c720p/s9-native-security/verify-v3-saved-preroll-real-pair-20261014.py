#!/usr/bin/env python3
"""Verify the exact post-cutover 4K + pre-event pair on S9; clean only test media.

No new recording is triggered. The two named diagnostic files are downloaded
read-only from microSD, ffprobed and decoded; deletion occurs ONLY if every
acceptance gate passes and only for exact diagnostic_preroll_* filenames.
"""
from pathlib import Path
import datetime,hashlib,json,re,subprocess,tempfile,urllib.request
ROOT=Path("/home/jespern/c720p-home-hub")
OUT=ROOT/"build/s9-preroll-v3/verified_real_4k_preroll_pair.json"
PHONE="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
CLIP="diagnostic_preroll_1791959325168.mp4"
SERIAL="192.168.178.250:5555"
def run(cmd,t=50):
 p=subprocess.run(cmd,text=True,capture_output=True,timeout=t)
 if p.returncode:raise RuntimeError("command_failed "+repr(cmd[:3])+" "+p.stderr[-400:])
 return p.stdout
def video(p):
 r=json.loads(run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(p)],25))
 st=[x for x in r["streams"] if x.get("codec_type")=="video"]
 if len(st)!=1:raise RuntimeError("invalid_video_stream")
 v=st[0]
 return {"width":int(v["width"]),"height":int(v["height"]),"codec":v["codec_name"],
  "duration_sec":float(r["format"]["duration"]),"fps":v.get("avg_frame_rate"),"bytes":p.stat().st_size,
  "sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
def main():
 if not re.fullmatch(r"diagnostic_preroll_[0-9]{13}[.]mp4",CLIP):raise RuntimeError("unsafe_name")
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as response:state=json.load(response)
 if not(state.get("ok") is True and state.get("mode")=="watching" and
   state.get("garden_person_gate_backend")=="gpu" and
   state.get("native_4k_enabled") is True and
   state.get("preroll_version")=="s9_on_phone_avc_memory_ring_keyframe_7s_v3"):
  raise RuntimeError("camera_unhealthy_or_wrong_version")
 if state.get("preroll_diagnostic_clip")!=CLIP:
  raise RuntimeError("diagnostic_not_from_this_camera_session")
 with tempfile.TemporaryDirectory(prefix="s9-preroll-v3-real-",dir="/tmp") as tmp:
  samples={}
  for name in (CLIP,CLIP+".preroll.mp4"):
   local=Path(tmp)/name
   run(["adb","-s",SERIAL,"pull",PHONE+"/"+name,str(local)],95)
   if local.stat().st_size<10000:raise RuntimeError("diagnostic_file_too_small")
   info=video(local)
   run(["ffmpeg","-hide_banner","-nostdin","-threads","1","-v","error",
      "-i",str(local),"-map","0:v:0","-frames:v","2","-f","null","-"],50)
   samples[name]=info
  main=samples[CLIP];pre=samples[CLIP+".preroll.mp4"]
  if (main["width"],main["height"],main["codec"])!=(3840,2160,"h264"):
   raise RuntimeError("original_4k_mismatch")
  if (pre["width"],pre["height"],pre["codec"])!=(640,480,"h264"):
   raise RuntimeError("preroll_h264_mismatch")
  if not(6<=main["duration_sec"]<=40 and 5.5<=pre["duration_sec"]<=9.3):
   raise RuntimeError("preroll_or_event_duration_invalid")
  report={"verified":True,"test":"S9_PREROLL_V3_4K_PAIR_INDEPENDENT",
    "source":"labelled_one_shot_diagnostic_not_surveillance_index",
    "original_4k":main,"keyframe_preroll":pre,
    "saved_preroll_duration_ms":state.get("preroll_last_duration_ms"),
    "camera_health":{"mode":state.get("mode"),"temperature_c":state.get("temperature_c"),
      "gpu":state.get("garden_person_gate_backend"),"preroll_version":state.get("preroll_version")},
    "generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat()}
  OUT.parent.mkdir(parents=True,exist_ok=True)
  OUT.write_text(json.dumps(report,sort_keys=True,indent=2)+"\n")
  print("S9_V3_REAL_PREROLL_VERIFIED",json.dumps(report,sort_keys=True),flush=True)
  # Both validated files were created solely by the one-shot diagnostic.
  run(["adb","-s",SERIAL,"shell","rm","--",PHONE+"/"+CLIP,
       PHONE+"/"+CLIP+".preroll.mp4"],35)
  print("S9_DIAGNOSTIC_MEDIA_CLEANED_ONLY",CLIP,flush=True)
if __name__=="__main__":main()
