#!/usr/bin/env python3
"""Authenticated Security clip RGB565 chunks for low-CPU 25fps WebGL playback.

Designed to mount on the existing C720P archive proxy through
s9_hub_playback.install(handler_class, phone_rows). Every request passes the
existing verified source() checks. Only existing smooth derived MP4s are read,
only private bounded RGB565 files are written, never original recordings.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.parse

ROOT=Path("/tmp/c720p-security-rgb565")
PROFILE="rgb565_320x180_25fps_v1"
WIDTH=320
HEIGHT=180
FPS=25
BYTES_PER_FRAME=WIDTH*HEIGHT*2
CHUNK_SECONDS=5
MAX_CHUNKS=36
MAX_TOTAL_BYTES=450*1024*1024
TTL_SECONDS=3600
LOCK=threading.Lock()
JOBS={}
ACTIVE=0
VALID_PARAM=re.compile(r"[0-9]{1,2}\Z")

def cache_init():
 ROOT.mkdir(parents=True,exist_ok=True)
 ROOT.chmod(0o700)

def key_for(source_key,chunk):
 token=f"{PROFILE}:{source_key}:{chunk}"
 return hashlib.sha256(token.encode("utf-8")).hexdigest()

def file_pair(key):
 return ROOT/("s9raw-"+key+".bin"),ROOT/("s9raw-"+key+".json")

def cache_read(key):
 video,manifest=file_pair(key)
 try:
  if not video.is_file() or not manifest.is_file() or video.is_symlink() or manifest.is_symlink():
   return None
  data=json.loads(manifest.read_text())
  size=video.stat().st_size
  if (data.get("key")!=key or data.get("profile")!=PROFILE or
      data.get("frames")!=size//BYTES_PER_FRAME or
      not 2<=data.get("frames",0)<=CHUNK_SECONDS*FPS+3 or
      size%BYTES_PER_FRAME or size>BYTES_PER_FRAME*(CHUNK_SECONDS*FPS+3)):
   return None
  return video,data
 except (OSError,ValueError,TypeError,json.JSONDecodeError):
  return None

def purge():
 now=time.time()
 files=[]
 for video in ROOT.glob("s9raw-*.bin"):
  try:
   meta=video.with_suffix(".json")
   stat=video.stat()
   if now-stat.st_mtime>TTL_SECONDS:
    video.unlink(missing_ok=True)
    meta.unlink(missing_ok=True)
   else:files.append((video,stat))
  except OSError:pass
 size=sum(stat.st_size for _,stat in files)
 for file,stat in sorted(files,key=lambda x:x[1].st_mtime):
  if size<=MAX_TOTAL_BYTES:break
  try:
   file.unlink(missing_ok=True)
   file.with_suffix(".json").unlink(missing_ok=True)
   size-=stat.st_size
  except OSError:pass

def worker(clip_path,key,chunk):
 global ACTIVE
 target,manifest=file_pair(key)
 temp=target.with_suffix(".partial")
 temporary_meta=manifest.with_suffix(".json.partial")
 try:
  # The source is already a verified private smooth MP4, never an arbitrary URL.
  if not clip_path.is_file() or clip_path.is_symlink():raise OSError("smooth_clip_unavailable")
  purge()
  temp.unlink(missing_ok=True)
  seek=chunk*CHUNK_SECONDS
  cmd=["/usr/bin/nice","-n","12","ffmpeg","-nostdin","-hide_banner",
       "-loglevel","error","-y","-ss",str(seek),"-i",str(clip_path),
       "-t",str(CHUNK_SECONDS),"-vf",f"fps={FPS},scale={WIDTH}:{HEIGHT},format=rgb565le",
       "-pix_fmt","rgb565le","-an","-f","rawvideo",str(temp)]
  proc=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=95)
  if proc.returncode:raise OSError("raw_transcode_failed")
  size=temp.stat().st_size
  frames=size//BYTES_PER_FRAME
  if size%BYTES_PER_FRAME or not 2<=frames<=CHUNK_SECONDS*FPS+3:
   raise ValueError("invalid_raw_chunk")
  doc={"key":key,"profile":PROFILE,"fps":FPS,"width":WIDTH,"height":HEIGHT,
       "frames":frames,"duration":frames/FPS,"chunk":chunk,
       "bytes":size,"source_originals_unchanged":True}
  temporary_meta.write_text(json.dumps(doc,separators=(",",":")))
  os.chmod(temp,0o600);os.chmod(temporary_meta,0o600)
  os.replace(temp,target)
  os.replace(temporary_meta,manifest)
  with LOCK:JOBS[key]={"state":"ready","meta":doc,"time":time.monotonic()}
 except (OSError,ValueError,subprocess.TimeoutExpired) as error:
  with LOCK:JOBS[key]={"state":"failed","error":type(error).__name__,"time":time.monotonic()}
 finally:
  temp.unlink(missing_ok=True)
  temporary_meta.unlink(missing_ok=True)
  with LOCK:ACTIVE=max(0,ACTIVE-1)

def queue(source,key,chunk,playback):
 global ACTIVE
 ready=cache_read(key)
 if ready:return {"ok":True,"state":"ready",**ready[1]}
 smooth=playback.cached(source)
 if not smooth:
  result=playback.prepare(source)
  return {"ok":True,"state":"preparing_source",
    "source_state":result.get("state"),"message":"Preparing low-CPU playback copy"}
 clip=Path(smooth[0])
 with LOCK:
  now=time.monotonic()
  job=JOBS.get(key)
  if job and job.get("state")=="failed" and now-job.get("time",now)>6:
   JOBS.pop(key,None);job=None
  if job and job.get("state") in ("queued","preparing"):
   return {"ok":True,"state":"preparing","message":"Converting private GPU frames"}
  if ACTIVE>=1:
   return {"ok":True,"state":"queued","message":"Waiting for background video converter"}
  ACTIVE+=1
  JOBS[key]={"state":"preparing","time":now}
 thread=threading.Thread(target=worker,args=(clip,key,chunk),
                         daemon=True,name="s9-lowcpu-rgb-video")
 thread.start()
 return {"ok":True,"state":"preparing","message":"Preparing five seconds of GPU frames"}

def serve(handler,file,meta):
 size=file.stat().st_size
 if handler.command not in ("GET","HEAD"):
  handler.js(405,{"ok":False,"error":"method_not_supported"});return
 try:
  with file.open("rb") as stream:
   handler.send_response(200)
   for key,value in {
      "Content-Type":"application/octet-stream",
      "Content-Length":str(size),
      "Cache-Control":"private,no-store",
      "X-Content-Type-Options":"nosniff",
      "X-S9-GPU-Frames":PROFILE,
      "Access-Control-Allow-Origin":"http://localhost:8123"}.items():
    handler.send_header(key,value)
   handler.end_headers()
   if handler.command=="HEAD":return
   while True:
    chunk=stream.read(65536)
    if not chunk:break
    handler.wfile.write(chunk)
 except (BrokenPipeError,ConnectionResetError):pass

def install(handler_class,phone_rows,playback):
 cache_init()
 original=handler_class.go
 def go(handler):
  uri=urllib.parse.urlsplit(handler.path)
  query=urllib.parse.parse_qs(uri.query)
  mode=query.get("playback",[""])[0]
  if mode not in ("rgb_prepare","rgb_pack"):
   return original(handler)
  match=playback.ROUTE.fullmatch(uri.path)
  if not match:
   return original(handler)
  if handler.command not in ("GET","HEAD"):
   handler.js(405,{"ok":False,"error":"read_only_video_preview"});return
  offset=query.get("chunk",["0"])
  if len(offset)!=1 or not VALID_PARAM.fullmatch(offset[0]):
   handler.js(400,{"ok":False,"error":"invalid_chunk"});return
  chunk=int(offset[0])
  if chunk>=MAX_CHUNKS:
   handler.js(400,{"ok":False,"error":"clip_chunk_out_of_bounds"});return
  try:
   src=playback.source(match.group(1),match.group(2),phone_rows)
   key=key_for(src["key"],chunk)
   if mode=="rgb_prepare":
    result=queue(src,key,chunk,playback)
    handler.js(200,result)
    return
   ready=cache_read(key)
   if ready:return serve(handler,*ready)
   handler.js(409,{"ok":False,"state":"preparing","error":"rgb_video_chunk_not_ready"})
  except (OSError,ValueError,TypeError,urllib.error.URLError):
   handler.js(503,{"ok":False,"error":"rgb_video_source_unavailable"})
 handler_class.go=go
