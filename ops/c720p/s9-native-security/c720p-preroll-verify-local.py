#!/usr/bin/env python3
"""On-C720P read-only checker for real S9+ person-event pre-roll MP4 pairs.

Runs every 5 minutes via systemd, *not* ChatGPT tasks. Uses the existing
private ADB-forwarded on-phone HTTP range endpoint, never copies or deletes
recordings, never starts a diagnostic/person event, never calls ffmpeg
transcoding, and never causes background classification.
"""
import datetime,json,os,pathlib,re,subprocess,tempfile,urllib.error,urllib.request
from zoneinfo import ZoneInfo
ARCHIVE="http://127.0.0.1:8795/new/api/saved"
PHONE="http://127.0.0.1:18808"
HOME=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
OUTPUT=HOME/"preroll-validation.json"
NAME=re.compile(r"motion_([0-9]{13})[.]mp4")
# First V9 prebuffer actually installed before the explicitly labelled test build.
CUTOFF_MS=int(datetime.datetime.fromisoformat("2026-10-11T23:55:00+02:00").timestamp()*1000)
def request(url,method="GET",timeout=12):
 with urllib.request.urlopen(urllib.request.Request(url,method=method),timeout=timeout) as r:
  if method=="HEAD":return int(r.headers.get("Content-Length","0"))
  return json.load(r)
def inspect(path):
 p=subprocess.run(["ffprobe","-v","error","-show_entries",
  "stream=codec_name,width,height,avg_frame_rate:format=duration",
  "-of","json",PHONE+"/clip/"+path],capture_output=True,text=True,timeout=22)
 if p.returncode:raise RuntimeError("ffprobe_video_stream_unreadable")
 d=json.loads(p.stdout);v=next((x for x in d.get("streams",[]) if x.get("codec_name") in ("h264","hevc")),None)
 if not v:raise RuntimeError("missing_video_stream")
 return {"width":int(v["width"]),"height":int(v["height"]),
         "codec":v["codec_name"],"fps":v.get("avg_frame_rate"),
         "duration_s":round(float(d["format"]["duration"]),3)}
def publish(result):
 HOME.mkdir(parents=True,exist_ok=True)
 data=json.dumps(result,sort_keys=True,indent=2)+"\n"
 with tempfile.NamedTemporaryFile(mode="w",encoding="utf-8",dir=HOME,prefix=".preroll-validation-",delete=False) as f:
  f.write(data);tmp=f.name
 try:
  os.chmod(tmp,0o644)
  os.replace(tmp,OUTPUT)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 now=datetime.datetime.now(ZoneInfo("Europe/Amsterdam")).isoformat()
 state={"checked_at":now,"source":"S9+ microSD Camera2 genuine events only",
  "status":"awaiting_new_person_event","verified":False,"candidate_count":0,
  "verification_method":"independent phone HTTP range + ffprobe metadata",
  "original_media_modified":False,"test_recording_triggered":False}
 try:
  arc=request(ARCHIVE)
  if arc.get("archive_mode")!="S9-microSD-only":raise RuntimeError("unexpected_archive")
  eventlist=arc.get("events")
  if not isinstance(eventlist,list):raise RuntimeError("archive_events_unavailable")
  clips=sorted([(int(n.group(1)),n.group(0)) for x in eventlist
    if (n:=NAME.fullmatch(str(x.get("clip_no","")))) and int(n.group(1))>=CUTOFF_MS],reverse=True)
  state["candidate_count"]=len(clips)
  state["archive_clips"]=len(eventlist)
  if not clips:
   publish(state);print("PREROLL_MONITOR_WAITING_NO_NEW_CLIP");return
  # Only inspect the latest three, never an exhaustive old archive scan.
  state["latest_motion_clip"]=clips[0][1]
  for ts,clip in clips[:3]:
   sidecar=clip+".preroll.mp4"
   try:
    size=request(PHONE+"/clip/"+sidecar,"HEAD")
    if size<10000 or size>60000000:continue
   except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError):
    continue
   state["status"]="preroll_pair_found_validating"
   try:
    original=inspect(clip);early=inspect(sidecar)
    if (original["width"],original["height"])!=(3840,2160):
     raise RuntimeError("main_not_4k")
    if (early["width"],early["height"])!=(640,480):
     raise RuntimeError("preroll_not_640x480")
    if original["codec"]!="h264" or early["codec"]!="h264":
     raise RuntimeError("codec_mismatch")
    if original["duration_s"]<2 or early["duration_s"]<2:
     raise RuntimeError("preroll_or_main_too_short")
    state.update({"status":"verified_container_pair","verified":True,
      "clip":clip,"preroll_file":sidecar,"preroll_bytes":size,
      "source":original,"buffer":early})
    break
   except (ValueError,KeyError,RuntimeError,subprocess.TimeoutExpired) as error:
    state["status"]="preroll_pair_failed_probe"
    state["probe_error"]=str(error)[:160]
  if not state["verified"] and state["status"]=="awaiting_new_person_event":
   state["status"]="new_event_waiting_for_preroll"
  publish(state)
  print("S9_PREROLL_LOCAL_VERIFICATION",json.dumps({k:state.get(k) for k in
   ("status","verified","candidate_count","clip","probe_error")},sort_keys=True))
 except Exception as e:
  state["status"]="monitor_unavailable";state["error"]=str(e)[:160]
  publish(state);print("S9_PREROLL_LOCAL_VERIFY_ERROR",str(e)[:160])
if __name__=="__main__":main()
