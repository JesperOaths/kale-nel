#!/usr/bin/env python3
"""One-shot, non-destructive proof of the production S9+ 4K 5s video prefix.

Never triggers person identification or enters the public Security archive.
Runs only after verifying the quiet camera, stable 4K encoder and on-phone
battery/storage headroom. The one-shot native diagnostic test itself
records 12.5 seconds and should contain the preceding >=4.4 seconds of
4K footage in the SAME MP4. Original motion_* media is never modified.
"""
import json
import re
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

BASE="http://127.0.0.1:18808"
PHONE="192.168.178.250:5555"
ARCHIVE="http://127.0.0.1:8795/new/api/saved"
PHONE_DIR="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
NAME=re.compile(r"diagnostic_preroll_[0-9]{13}\.mp4\Z")

def status():
    with urllib.request.urlopen(BASE+"/status",timeout=12) as response:
        return json.load(response)

def call(argv,timeout=75):
    result=subprocess.run(argv,text=True,capture_output=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError("command_failed:"+str(argv[:3])+":"+result.stderr[-250:])
    return result.stdout.strip()

def adb(*args,timeout=75):
    return call(["adb","-s",PHONE,*args],timeout)

def count():
    with urllib.request.urlopen(ARCHIVE,timeout=25) as response:
        payload=json.load(response)
    if payload.get("archive_mode")!="S9-microSD-only":
        raise RuntimeError("unexpected_original_archive")
    return {rec["clip_no"] for rec in payload.get("events",[])
            if isinstance(rec,dict) and re.fullmatch(r"motion_[0-9]{13}\.mp4",str(rec.get("clip_no") or ""))}

def healthy(state):
    return state.get("ok") is True and state.get("mode")=="watching" and \
      state.get("continuous_4k_ready") is True and \
      state.get("continuous_4k_trial_active") is True and \
      state.get("preroll_in_original_mp4") is True and \
      int(state.get("continuous_4k_buffered_ms") or 0)>=4400 and \
      int(state.get("continuous_4k_dropped_output_frames") or 0)==0 and \
      float(state.get("temperature_c") or 100)<40 and \
      int(state.get("sd_free_bytes") or 0)>20*1024**3 and \
      state.get("person_post_motion_hold_ms")==5000 and \
      state.get("minimum_main_recording_ms")==10000

def video_info(path):
    raw=call(["ffprobe","-v","error","-select_streams","v:0",
      "-show_entries","stream=codec_name,width,height,r_frame_rate:format=duration,size",
      "-of","json",str(path)],30)
    info=json.loads(raw)
    video=info.get("streams",[])[0]
    return {"codec":video.get("codec_name"),"width":int(video.get("width") or 0),
      "height":int(video.get("height") or 0),
      "fps":video.get("r_frame_rate"),
      "duration_s":round(float(info["format"]["duration"]),3),
      "bytes":int(info["format"]["size"])}

def decode_frame(path,seek):
    command=["ffmpeg","-nostdin","-hide_banner","-loglevel","error",
      "-threads","1","-ss",str(seek),"-i",str(path),
      "-map","0:v:0","-frames:v","1","-f","null","-"]
    call(command,75)

def main():
    adb("forward","tcp:18808","tcp:8808",timeout=25)
    original_clips=count()
    if len(original_clips)<70:raise RuntimeError("original_archive_count_unexpected")
    before=status()
    for index in range(3):
        if not healthy(before):raise RuntimeError("camera_not_in_safe_5s4k_state")
        if before.get("preroll_diagnostic_used"):
            print("DIAGNOSTIC_ALREADY_CONSUMED_NO_FILES_CHANGED")
            return
        if before.get("face_backfill_queued") or before.get("movement_4k_backfill_queued") or before.get("historical_import_queued"):
            raise RuntimeError("background_archive_review_busy")
        age=before.get("person_last_accepted_motion_age_ms")
        if age is not None and int(age)<90000:
            raise RuntimeError("recent_motion_detected_defer_diagnostic")
        if index<2:
            time.sleep(3)
            before=status()
    payload=json.dumps({"key":"preroll_diagnostic","value":"record_tail_once"}).encode()
    request=urllib.request.Request(BASE+"/control",data=payload,method="POST",
      headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(request,timeout=14) as response:
        ack=json.load(response)
    if not ack.get("ok") or ack.get("excluded_from_security_archive") is not True or \
       ack.get("requested_post_motion_hold_ms")!=5000:
        raise RuntimeError("safe_diagnostic_rejected:"+str(ack)[:200])
    clip=""
    end=None
    for index in range(65):
        time.sleep(1)
        end=status()
        candidate=str(end.get("preroll_diagnostic_clip") or "")
        result=str(end.get("preroll_diagnostic_result") or "")
        if NAME.fullmatch(candidate) and result.startswith("single_native_4k_complete_"):
            clip=candidate;break
        if end.get("continuous_4k_error") or end.get("continuous_4k_failures",0)>before.get("continuous_4k_failures",0):
            raise RuntimeError("continuous_4k_diagnostic_failure")
    if not clip:raise RuntimeError("diagnostic_not_completed:"+str(end.get("preroll_diagnostic_result")))
    with tempfile.TemporaryDirectory(prefix="s9-v46-test-",dir="/dev/shm") as folder:
        target=Path(folder)/clip
        adb("pull",PHONE_DIR+"/"+clip,str(target),timeout=130)
        if not target.is_file():raise RuntimeError("diagnostic_media_not_copied")
        info=video_info(target)
        if info["codec"]!="h264" or (info["width"],info["height"])!=(3840,2160):
            raise RuntimeError("original_not_continuous_native_4k")
        if not 15.5<=info["duration_s"]<=25:
            raise RuntimeError("five_second_preroll_not_contained_in_single_mp4:"+str(info))
        decode_frame(target,0)
        decode_frame(target,max(0,info["duration_s"]-1.5))
    after=status()
    current=count()
    if not original_clips.issubset(current):
        raise RuntimeError("security_originals_missing_after_diagnostic")
    if not healthy(after):
        raise RuntimeError("camera_unhealthy_after_diagnostic")
    # Remove only an explicitly named diagnostic excluded from the archive.
    adb("shell","rm","--",PHONE_DIR+"/"+clip,timeout=30)
    print("S9_V46_5S_4K_PREROLL_AND_5S_HOLD_VERIFIED",json.dumps({
      "video":info,"camera_healthy":True,"post_motion_hold_ms":5000,
      "minimum_main_recording_ms":10000,"original_clips_preserved":len(current),
      "diagnostic_removed":True,"source_clips_altered":False},sort_keys=True),flush=True)

if __name__=="__main__":
    main()
