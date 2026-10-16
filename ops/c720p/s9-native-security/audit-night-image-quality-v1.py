#!/usr/bin/env python3
"""Read-only S9 Camera2 night-image quality check, executed on the C720P.

Does not store, upload, alter or display a camera frame. Decodes short-lived
native JPEGs to small grayscale arrays, then reports numeric scene evidence.
The S9 remains responsible for all image capture and 4K processing.
"""
from __future__ import annotations
import io
import json
import math
import shutil
import statistics
import subprocess
import time
import urllib.request
from typing import Sequence

NATIVE="http://127.0.0.1:18808"
SAMPLES=5
BOUND=1_800_000

def read(route: str, limit: int=BOUND) -> bytes:
 with urllib.request.urlopen(NATIVE+route,timeout=10) as response:
  if response.status!=200:raise RuntimeError("native_http_unavailable")
  data=response.read(limit+1)
  if len(data)>limit:raise RuntimeError("native_response_too_large")
  return data

def state()->dict:
 data=json.loads(read("/status",150_000))
 if not data.get("ok"):raise RuntimeError("camera_not_healthy")
 return data

def gray(jpeg:bytes)->bytes:
 if not jpeg.startswith(b"\xff\xd8") or len(jpeg)<2500:
  raise RuntimeError("native_preview_jpeg_invalid")
 # No network, no persistent files. FFmpeg reads only the in-memory JPEG.
 if shutil.which("ffmpeg"):
  p=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
    "-f","image2pipe","-vcodec","mjpeg","-i","pipe:0",
    "-vf","scale=160:90:flags=fast_bilinear,format=gray",
    "-frames:v","1","-f","rawvideo","-pix_fmt","gray","pipe:1"],
    input=jpeg,capture_output=True,timeout=12)
  if p.returncode==0 and len(p.stdout)==14400:return p.stdout
 try:
  from PIL import Image
  with Image.open(io.BytesIO(jpeg)) as img:
   if img.width<320 or img.height<240:raise RuntimeError("preview_too_small")
   return img.convert("L").resize((160,90)).tobytes()
 except (ImportError, OSError) as e:
  raise RuntimeError("jpeg_decoder_unavailable") from e

def metrics(pixels:bytes)->dict:
 if len(pixels)!=14400:raise RuntimeError("gray_frame_shape")
 values=sorted(pixels)
 def pct(f:float)->int:return values[min(len(values)-1,int(f*(len(values)-1)))]
 dark=sum(v<40 for v in pixels)/len(pixels)
 nearblack=sum(v<20 for v in pixels)/len(pixels)
 clipped=sum(v>=245 for v in pixels)/len(pixels)
 # Edge energy is a sharpness/texture proxy, not a focus or object ID claim.
 acc=0;n=0
 for y in range(4,86,2):
  for x in range(4,156,2):
   i=y*160+x
   // Use a two-pixel stride to avoid silently skipping aligned vertical edges.
   acc+=abs(pixels[i]-pixels[i+2])+abs(pixels[i]-pixels[i+320]);n+=2
 return {"mean":round(sum(pixels)/len(pixels),2),
         "p10":pct(.10),"p50":pct(.50),"p90":pct(.90),
         "dark_fraction":round(dark,3),"nearblack_fraction":round(nearblack,3),
         "clipped_fraction":round(clipped,3),
         "local_edge_energy":round(acc/n,2)}

def main()->None:
 start=state()
 if start.get("mode")!="watching" or not start.get("native_4k_enabled"):
  raise RuntimeError("camera_busy_or_not_4k_no_probe")
 if not start.get("night_mode") in ("auto","on","off"):
  raise RuntimeError("night_exposure_version_missing")
 records=[]
 jpg_sizes=[]
 for k in range(SAMPLES):
  snap=state()
  if snap.get("mode")!="watching":
   raise RuntimeError("camera_became_busy_abort_readonly_probe")
  jpeg=read("/shot.jpg")
  img=gray(jpeg)
  jpg_sizes.append(len(jpeg))
  records.append({"brightness":metrics(img),
    "night_active":bool(snap.get("night_active")),
    "sensor_iso":snap.get("sensor_iso"),
    "sensor_exposure_ms":snap.get("sensor_exposure_ms"),
    "sensor_result_fps":snap.get("sensor_result_fps"),
    "ae_state":snap.get("sensor_ae_state"),
    "night_luminance":snap.get("night_luminance")})
  if k<SAMPLES-1:time.sleep(1.5)
 end=state()
 means=[r["brightness"]["mean"] for r in records]
 dark=[r["brightness"]["dark_fraction"] for r in records]
 edges=[r["brightness"]["local_edge_energy"] for r in records]
 p10=[r["brightness"]["p10"] for r in records]
 p90=[r["brightness"]["p90"] for r in records]
 night_ev=None
 try:
  options=json.loads(read("/controls",100_000)).get("controls",{})
  night_ev=options.get("night_effective_ev")
 except (ValueError,RuntimeError):pass
 print("S9_NIGHT_IMAGE_QUALITY_V1 "+json.dumps({
  "samples":SAMPLES,"read_only":True,"frames_transferred_out":0,
  "camera_mode":end.get("mode"),"camera_4k_ready":end.get("continuous_4k_ready"),
  "night_mode":end.get("night_mode"),"night_active":end.get("night_active"),
  "night_ev":night_ev,"night_auto_switches":end.get("night_auto_switches"),
  "median_preview_gray":round(statistics.median(means),2),
  "median_pixel_p10":round(statistics.median(p10),1),
  "median_pixel_p90":round(statistics.median(p90),1),
  "median_dark_fraction":round(statistics.median(dark),3),
  "median_edge_energy":round(statistics.median(edges),2),
  "preview_brightness_spread":round(max(means)-min(means),2),
  "preview_jpeg_bytes_range":[min(jpg_sizes),max(jpg_sizes)],
  "sensor_iso":end.get("sensor_iso"),
  "sensor_exposure_ms":end.get("sensor_exposure_ms"),
  "sensor_result_fps":end.get("sensor_result_fps"),
  "sensor_ae_state":end.get("sensor_ae_state"),
  "scene_luma":end.get("night_luminance"),
  "temperature_c":end.get("temperature_c"),
  "sd_free_gib":round(end.get("sd_free_bytes",0)/1024**3,2),
  "source_recording_count":end.get("recorded"),
  "diagnosis":("still_very_dark_even_with_night_exposure"
    if statistics.median(means)<45 and statistics.median(dark)>.48
    else "dark_but_details_measurable"
    if statistics.median(means)<75
    else "visible_brightness_sufficient_for_scene_review"),
  "comparability":"preview_only_no_preupgrade_matching_view",
 },sort_keys=True),flush=True)

if __name__=="__main__":main()
