#!/usr/bin/env python3
"""Production-safe, bounded S9 pre-motion + 4K-event MP4 compositor.

Safety policy: source files remain on the S9 microSD; never run FFmpeg inside
the S9 Camera2 process. Decode from authenticated ADB-local phone HTTP and
temporarily encode 720p30 on the isolated, low-priority C720P worker. Validate
both segments, hash the uploaded derivative, publish atomically to microSD.
Stop promptly if another recording begins or the phone becomes unhealthy.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
API="http://127.0.0.1:18808"
STATE=Path("/home/jespern/c720p-home-hub/build/s9-complete-worker-v1/state.json")
REPORTS=Path("/home/jespern/c720p-home-hub/build/s9-complete-worker-v1/receipts")
BASE=re.compile(r"^motion_([0-9]{13})[.]mp4$")
PRE=re.compile(r"^motion_([0-9]{13})[.]mp4[.]preroll[.]mp4$")
OUTSUFFIX=".complete.mp4"
MIN_AGE_SECONDS=90
MAX_AGE_DAYS=14
MAX_ATTEMPTS=3
STORAGE_MIN=420*1024*1024
MAX_OUTPUT=100*1024*1024
FILTER=("[0:v:0]setpts=PTS-STARTPTS,"
 "scale=1280:720:force_original_aspect_ratio=decrease,"
 "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[p];"
 "[1:v:0]setpts=PTS-STARTPTS,"
 "scale=1280:720:force_original_aspect_ratio=decrease,"
 "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[e];"
 "[p][e]concat=n=2:v=1:a=0[v]")

def command(argv,timeout=35):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed "+
   " ".join(argv[:4])+": "+p.stderr[-450:].strip())
 return p.stdout.strip()

def phone():
 rows=command(["adb","devices","-l"],12).splitlines()
 usb=[r.split()[0] for r in rows if " device " in r and
      "model:SM_G965F" in r and "usb:" in r]
 if len(usb)==1:return usb[0]
 wifi=[r.split()[0] for r in rows if " device " in r and
       "model:SM_G965F" in r and r.startswith("192.168.178.250:5555")]
 if len(wifi)==1:return wifi[0]
 # Reattach only the already-authorized, pinned S9 Wi-Fi ADB endpoint.
 subprocess.run(["adb","connect","192.168.178.250:5555"],
   capture_output=True,text=True,timeout=9)
 rows=command(["adb","devices","-l"],12).splitlines()
 if any(r.startswith("192.168.178.250:5555") and
        " device " in r and "model:SM_G965F" in r for r in rows):
  return "192.168.178.250:5555"
 raise RuntimeError("authorized_S9_ADB_unavailable")

def adb(serial,*parts,timeout=30):
 return command(["adb","-s",serial,*parts],timeout)

def status():
 with urllib.request.urlopen(API+"/status",timeout=7) as r:
  d=json.load(r)
 return d

def safe(s):
 return (s.get("ok") is True and s.get("mode")=="watching"
  and s.get("native_4k_enabled") is True
  and s.get("garden_person_gate_backend")=="gpu"
  and s.get("preroll_ready") is True
  and s.get("temperature_c",100)<36.2
  and s.get("last_frame_age_ms",100000)<2600
  and s.get("sd_free_bytes",0)>10*1024**3)

def head(url):
 with urllib.request.urlopen(urllib.request.Request(url,method="HEAD"),timeout=13) as r:
  if r.status!=200 or r.headers.get("Content-Type","").split(";")[0]!="video/mp4":
   raise RuntimeError("phone_media_head_invalid")
  size=int(r.headers.get("Content-Length","-1"))
  if size<10000:raise RuntimeError("phone_media_too_small")
  return size

def clip_url(name):
 if not re.fullmatch(r"motion_[0-9]{13}[.]mp4(?:[.]preroll[.]mp4)?",name):
  raise ValueError("unsafe_media_name")
 return API+"/clip/"+name

def video(src,timeout=30):
 out=command(["ffprobe","-v","error","-show_streams","-show_format",
              "-of","json",src],timeout)
 obj=json.loads(out)
 streams=[v for v in obj["streams"] if v.get("codec_type")=="video"]
 if len(streams)!=1:raise RuntimeError("video_stream_missing_or_ambiguous")
 st=streams[0]
 return {"duration":float(obj["format"]["duration"]),
    "width":int(st["width"]),"height":int(st["height"]),
    "codec":st["codec_name"],"fps":st.get("avg_frame_rate","")}

def sha(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()

def read_state():
 try:
  obj=json.loads(STATE.read_text())
  return obj if isinstance(obj,dict) else {}
 except (OSError,ValueError):return {}

def atomic_json(p,obj):
 p.parent.mkdir(parents=True,exist_ok=True)
 t=p.with_name(p.name+".new")
 with t.open("w") as f:
  json.dump(obj,f,sort_keys=True,indent=2);f.write("\n")
 os.replace(t,p)

def pick(serial,states):
 raw=adb(serial,"shell","ls -1 '"+SD+"'",timeout=50)
 names={n.strip() for n in raw.splitlines()}
 now=time.time()
 candidates=[]
 for n in names:
  m=BASE.fullmatch(n)
  if not m or n+".preroll.mp4" not in names or n+".complete.mp4" in names:
   continue
  age=now-int(m.group(1))/1000
  if not MIN_AGE_SECONDS<age<MAX_AGE_DAYS*86400:continue
  item=states.get(n,{})
  if item.get("failures",0)>=MAX_ATTEMPTS:continue
  if now-float(item.get("last_attempt",0))<min(3600,90*2**item.get("failures",0)):
   continue
  candidates.append((int(m.group(1)),n))
 candidates.sort(reverse=True)
 return candidates,names

class Cancelled(Exception):pass

def encode(pre,original,output,first):
 cmd=["nice","-n","18","ffmpeg","-hide_banner","-nostdin","-loglevel","error",
  "-threads","2","-i",pre,"-i",original,
  "-filter_complex",FILTER,"-map","[v]","-an","-c:v","libx264",
  "-preset","ultrafast","-threads","2","-b:v","2600000",
  "-g","45","-pix_fmt","yuv420p","-movflags","+faststart",str(output)]
 child=subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,start_new_session=True)
 start=time.monotonic();trouble=0
 try:
  while child.poll() is None:
   if time.monotonic()-start>660:raise Cancelled("encoding_time_limit")
   time.sleep(4)
   try:
    s=status()
    if not safe(s) or s.get("recorded",0)!=first.get("recorded",0):
     raise Cancelled("live_recording_or_camera_health_changed")
    trouble=0
   except Cancelled:raise
   except Exception:
    trouble+=1
    if trouble>=2:raise Cancelled("phone_status_unavailable")
  stderr=(child.stderr.read() or b"")[-3000:].decode("utf-8","replace")
  if child.returncode:raise RuntimeError("encoding_failed_"+stderr[-500:])
 finally:
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=6)
   except subprocess.TimeoutExpired:
    os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
  child.stderr.close()

def combine(serial,name,first):
 pre_name=name+".preroll.mp4"
 urls=(clip_url(pre_name),clip_url(name))
 sizes=(head(urls[0]),head(urls[1]))
 if not(20000<sizes[0]<20_000_000 and 200000<sizes[1]<950_000_000):
  raise RuntimeError("unusual_source_size")
 p=video(urls[0],25);main=video(urls[1],35)
 if not(1<=p["duration"]<=10 and 0.9<=main["duration"]<=125):
  raise RuntimeError("invalid_source_durations")
 if (p["width"],p["height"],p["codec"])!=(640,480,"h264"):
  raise RuntimeError("invalid_preroll_format")
 if (main["width"],main["height"],main["codec"])!=(3840,2160,"h264"):
  raise RuntimeError("invalid_4k_format")
 if shutil.disk_usage("/tmp").free<STORAGE_MIN:
  raise Cancelled("hub_ram_tmpfs_insufficient")
 if not safe(status()):raise Cancelled("phone_not_stable")
 with tempfile.TemporaryDirectory(prefix="s9-complete-worker-",dir="/tmp") as dirpath:
  out=Path(dirpath)/(name+".complete.mp4")
  encode(urls[0],urls[1],out,first)
  merged=video(str(out),35);duration=p["duration"]+main["duration"]
  if not(duration-1.2<=merged["duration"]<=duration+1.4):
   raise RuntimeError("merged_mp4_missing_segment")
  if (merged["width"],merged["height"],merged["codec"],merged["fps"])!=(
     1280,720,"h264","30/1"):
   raise RuntimeError("merged_mp4_playback_format_invalid")
  if not(80000<out.stat().st_size<MAX_OUTPUT):
   raise RuntimeError("merged_mp4_out_of_bounds")
  for at in (min(p["duration"]/2,1),p["duration"]+min(main["duration"]/2,1)):
   command(["ffmpeg","-v","error","-ss",str(at),"-i",str(out),
     "-frames:v","1","-f","null","-"],50)
  if [head(url) for url in urls]!=list(sizes):
   raise Cancelled("source_files_changed_after_encoding")
  if not safe(status()):raise Cancelled("phone_unhealthy_before_publish")
  digest=sha(out)
  tmp=SD+"/"+name+".complete.upload-v1.mp4"
  dest=SD+"/"+name+".complete.mp4"
  # Only write a derivative, to the removable microSD. Never modify originals.
  adb(serial,"push",str(out),tmp,timeout=120)
  uploaded=adb(serial,"shell","sha256sum '"+tmp+"'",timeout=65).split()[0]
  if uploaded!=digest:raise RuntimeError("upload_sha256_mismatch")
  # Atomic no-overwrite publish: if another worker won the race, keep its file.
  adb(serial,"shell","test ! -e '"+dest+"' && mv '"+tmp+"' '"+dest+"'",timeout=23)
  remote=adb(serial,"shell","sha256sum '"+dest+"'",timeout=65).split()[0]
  if remote!=digest:raise RuntimeError("published_sha256_mismatch")
  result={"verified":True,"name":name,"combined_name":name+".complete.mp4",
   "duration_sec":merged["duration"],"preroll_sec":p["duration"],
   "event_sec":main["duration"],"bytes":out.stat().st_size,
   "format":merged,"sha256":digest,"phone_sd_path":dest,
   "input_bytes":{"preroll":sizes[0],"original_4k":sizes[1]},
   "both_segments_decoded":True,"original_4k_unchanged":True,
   "generated_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
   "backend":"bounded_c720p_isolated_worker"}
  atomic_json(REPORTS/(name+".json"),result)
  return result

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--dry-run",action="store_true")
 parser.add_argument("--name",default=None)
 args=parser.parse_args()
 # Retire dangerous in-camera merger; this isolated worker must be alone.
 unit=subprocess.run(["systemctl","--user","is-active",
   "c720p-s9-joined-preroll-safe-upgrade.timer"],capture_output=True,text=True)
 if unit.stdout.strip()=="active":raise RuntimeError("unsafe_legacy_merger_still_active")
 try:
  serial=phone()
  s=status()
 except (RuntimeError,OSError,subprocess.TimeoutExpired,ValueError) as exc:
  print("JOINER_DEFER_PHONE_OR_RELAY_UNAVAILABLE",type(exc).__name__,flush=True)
  return 0
 if not safe(s):
  print("JOINER_DEFER_HEALTH",s.get("mode"),s.get("temperature_c"),flush=True)
  return 0
 failures=read_state()
 files,known=pick(serial,failures)
 if args.name:
  if not BASE.fullmatch(args.name):raise ValueError("invalid_name")
  files=[(int(args.name[7:20]),args.name)] if (
   args.name in known and args.name+".preroll.mp4" in known and
   args.name+".complete.mp4" not in known) else []
 if args.dry_run:
  print("JOINER_DRY_RUN",json.dumps({"eligible":len(files),
   "next":[name for _,name in files[:5]],"existing_complete":len(
    [n for n in known if n.endswith(".complete.mp4")])}),flush=True)
  return 0
 if not files:
  print("JOINER_IDLE_NOTHING_PENDING");return 0
 _,name=files[0]
 failures.setdefault(name,{})["last_attempt"]=time.time()
 atomic_json(STATE,failures)
 try:
  result=combine(serial,name,s)
 except Cancelled as exc:
  print("JOINER_DEFER_SAFE",name,str(exc),flush=True)
  # Reschedule short-lived guard failures without exhausting attempts.
  return 0
 except Exception as exc:
  failures[name]["failures"]=failures[name].get("failures",0)+1
  failures[name]["last_error"]=str(exc)[:320]
  atomic_json(STATE,failures)
  print("JOINER_FAILED",name,type(exc).__name__,str(exc)[:280],flush=True)
  return 1
 else:
  failures.pop(name,None)
  atomic_json(STATE,failures)
  print("JOINER_VERIFIED_PUBLISHED",json.dumps(result,sort_keys=True),flush=True)
  return 0
if __name__=="__main__":raise SystemExit(main())
