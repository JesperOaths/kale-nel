#!/usr/bin/env python3
"""One-off guarded proof MP4 from authentic S9 microSD event + pre-event.

Uses low-priority C720P FFmpeg ONLY as a recovery fallback after the S9's
on-device transcoder rebooted Android. All source files remain on the S9 and
untouched. Output goes back to S9's removable microSD; production should later
replace this with an isolated phone-side worker.
"""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,sys,time
SRC="motion_1791933495875.mp4"
SD=Path("/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K")
TEMP=Path("/tmp/s9-join-proof-20261014")
REPORT=Path("/home/jespern/c720p-home-hub/build/s9-onphone-prepended-mp4-v1c/verified-one-off-combined-mp4.json")
def run(a,timeout=40):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command failed "+str(a[:5])+": "+p.stderr[-1800:])
 return p.stdout.strip()
def usb():
 found=[row.split()[0] for row in run(["adb","devices","-l"]).splitlines()
        if "model:SM_G965F" in row and "usb:" in row and " device " in row]
 if len(found)!=1:raise RuntimeError("no_unique_authorized_s9_usb")
 return found[0]
def sha(f):
 h=hashlib.sha256()
 with f.open("rb") as inp:
  for b in iter(lambda:inp.read(1048576),b""):h.update(b)
 return h.hexdigest()
def probe(file):
 j=json.loads(run(["ffprobe","-v","error","-show_streams","-show_format",
    "-of","json",str(file)],30))
 vids=[v for v in j["streams"] if v["codec_type"]=="video"]
 if len(vids)!=1:raise RuntimeError("unexpected_video_streams")
 v=vids[0]
 return {"duration":float(j["format"]["duration"]),
  "width":int(v["width"]),"height":int(v["height"]),
  "codec":v["codec_name"],"fps":v.get("avg_frame_rate")}
def main():
 if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
  raise RuntimeError("ffmpeg_or_ffprobe_not_installed")
 enc=run(["ffmpeg","-hide_banner","-encoders"],15)
 if "libx264" not in enc:raise RuntimeError("no_web_playable_h264_encoder")
 if shutil.disk_usage("/tmp").free<220*1024**2:
  raise RuntimeError("insufficient_tmpfs_space")
 a=usb();target=SD/(SRC+".complete.mp4")
 source=SD/SRC;prefix=SD/(SRC+".preroll.mp4")
 # The one-off output must not replace an existing genuine S9 output.
 check=run(["adb","-s",a,"shell","ls -l '"+str(target)+"' 2>/dev/null || true"],15)
 if SRC+".complete.mp4" in check:raise RuntimeError("combined_file_already_exists")
 TEMP.mkdir(mode=0o700,parents=True,exist_ok=True)
 base=TEMP/SRC;pre=TEMP/(SRC+".preroll.mp4")
 for remote,local in ((source,base),(prefix,pre)):
  if not local.exists():
   print("PULLING",str(remote),flush=True)
   run(["adb","-s",a,"pull",str(remote),str(local)],125)
 if not 1_000_000<base.stat().st_size<150_000_000 or not 20_000<pre.stat().st_size<15_000_000:
  raise RuntimeError("source_files_unexpected_size")
 original_sha=sha(base);prefix_sha=sha(pre)
 start=probe(pre);main=probe(base)
 if not(1.0<start["duration"]<11 and 1.0<main["duration"]<125):
  raise RuntimeError("invalid_source_duration")
 if (start["width"],start["height"])!=(640,480) or (main["width"],main["height"])!=(3840,2160):
  raise RuntimeError("unexpected_source_dimensions")
 join=TEMP/target.name
 graph=("[0:v:0]setpts=PTS-STARTPTS,"
  "scale=1280:720:force_original_aspect_ratio=decrease,"
  "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[p];"
  "[1:v:0]setpts=PTS-STARTPTS,"
  "scale=1280:720:force_original_aspect_ratio=decrease,"
  "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[e];"
  "[p][e]concat=n=2:v=1:a=0[v]")
 if not join.is_file():
  cmd=["nice","-n","15","ffmpeg","-hide_banner","-nostdin",
   "-loglevel","error","-threads","2","-i",str(pre),"-i",str(base),
   "-filter_complex",graph,"-map","[v]","-an",
   "-c:v","libx264","-preset","ultrafast","-threads","2",
   "-b:v","2600k","-g","45","-pix_fmt","yuv420p",
   "-movflags","+faststart",str(join)]
  print("ENCODING_COMBINED_MP4",flush=True)
  run(cmd,360)
 result=probe(join)
 expected=start["duration"]+main["duration"]
 if not (expected-1.2<=result["duration"]<=expected+1.4):
  raise RuntimeError("combined_duration_does_not_include_both_segments")
 if (result["width"],result["height"],result["codec"])!=(1280,720,"h264"):
  raise RuntimeError("combined_h264_720p_invalid")
 if not result["fps"].startswith("30/"):
  raise RuntimeError("combined_fps_not_30")
 if join.stat().st_size<100000:raise RuntimeError("combined_mp4_too_small")
 # Verify actual decode near BOTH segment interiors, not just container.
 for when in (min(1.0,start["duration"]/2),start["duration"]+min(1.0,main["duration"]/2)):
  run(["nice","-n","15","ffmpeg","-hide_banner","-v","error",
   "-ss",str(when),"-i",str(join),"-frames:v","1","-f","null","-"],45)
 if sha(base)!=original_sha or sha(pre)!=prefix_sha:
  raise RuntimeError("local_copy_source_changed")
 # Upload to a distinct name then atomically publish ONLY the derivative.
 intermediate=SD/(SRC+".verification-upload.mp4")
 run(["adb","-s",a,"push",str(join),str(intermediate)],100)
 remote_sha=run(["adb","-s",a,"shell","sha256sum '"+str(intermediate)+"'"],20).split()[0]
 if remote_sha!=sha(join):raise RuntimeError("onphone_uploaded_mp4_hash_mismatch")
 run(["adb","-s",a,"shell","mv '"+str(intermediate)+"' '"+str(target)+"'"],15)
 final_sha=run(["adb","-s",a,"shell","sha256sum '"+str(target)+"'"],20).split()[0]
 if final_sha!=remote_sha:raise RuntimeError("onphone_final_hash_mismatch")
 # Read originals on device without touching them.
 s=run(["adb","-s",a,"shell",
  "stat -c %s '"+str(source)+"'; stat -c %s '"+str(prefix)+"'"],15).splitlines()
 if [int(x) for x in s]!=[base.stat().st_size,pre.stat().st_size]:
  raise RuntimeError("original_sizes_changed_after_join")
 info={"verified":True,"type":"one_off_recovery_fallback",
   "not_production_on_phone_transcode":True,
   "combined_path_on_phone":str(target),"sha256":final_sha,
   "bytes":join.stat().st_size,"format":result,
   "pre_event_duration_sec":start["duration"],
   "event_duration_sec":main["duration"],
   "combined_duration_sec":result["duration"],
   "source_4k_bytes":base.stat().st_size,"source_preroll_bytes":pre.stat().st_size,
   "source_4k_sha256":original_sha,"source_preroll_sha256":prefix_sha,
   "both_segments_decoded":True,"originals_untouched":True}
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 tmp=REPORT.with_suffix(".tmp");tmp.write_text(json.dumps(info,indent=2)+"\n");os.replace(tmp,REPORT)
 print("S9_VERIFIED_SINGLE_MP4_WITH_PRE_EVENT_AND_4K_EVENT",json.dumps(info,sort_keys=True),flush=True)
if __name__=="__main__":main()
