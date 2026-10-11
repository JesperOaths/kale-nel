#!/usr/bin/env python3
"""One-shot C720P performance pilot: 25 real JPEG frames/sec instead of H264 decode.

Only local temporary copies of existing *derived* 360p video are used.
An authenticated Chromium testing tab is created and restored automatically;
the local JPEG HTTP server binds to loopback and stops with this process.
Nothing changes on S9+ or in the Home Assistant production UI.
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CDP_FILE=pathlib.Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
def import_cdp():
 spec=importlib.util.spec_from_file_location("s9_temp_cdp",CDP_FILE)
 m=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(m)
 return m
def derive_frames(directory):
 sources=[]
 for meta in pathlib.Path("/tmp/c720p-security-playback").glob("*.json"):
  try:
   item=json.loads(meta.read_text())
   mp4=meta.with_suffix(".mp4")
   if item.get("profile")=="360p30" and mp4.is_file() and mp4.stat().st_size>20000:
    sources.append((meta.stat().st_mtime,mp4,item))
  except (OSError,ValueError):pass
 if not sources:raise RuntimeError("no_prepared_360p_playback_file")
 sources.sort(reverse=True)
 index=int(os.environ.get('S9_JPEG_SOURCE_INDEX','0'))
 if index<0 or index>=min(5,len(sources)):raise RuntimeError('selected_derived_clip_unavailable')
 clip=sources[index][1]
 command=["/usr/bin/nice","-n","12","ffmpeg","-hide_banner","-nostdin",
   "-loglevel","error","-y","-i",str(clip),"-t","5.1",
   "-vf","fps=25","-q:v","5","-start_number","0",
   str(directory/"frame-%03d.jpg")]
 p=subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=100)
 if p.returncode:raise RuntimeError("jpeg_extraction_failed:"+p.stderr[-180:].decode(errors="replace"))
 frames=sorted(directory.glob("frame-*.jpg"))
 if len(frames)<95:raise RuntimeError("insufficient_valid_jpeg_frames")
 if any(f.stat().st_size<2000 or f.stat().st_size>400000 for f in frames):
  raise RuntimeError("invalid_jpeg_file_size")
 return frames,clip,sources[index][2]

def main():
 m=import_cdp()
 with tempfile.TemporaryDirectory(prefix="s9-playback-jpeg-test-") as t:
  temp=pathlib.Path(t)
  frames,src,meta=derive_frames(temp)
  sizes=[p.stat().st_size for p in frames]
  offsets=[0]
  for size in sizes:offsets.append(offsets[-1]+size)
  packed=b"".join(p.read_bytes() for p in frames)
  if len(packed)!=offsets[-1]:raise RuntimeError("frame_pack_size_mismatch")
  class Handler(BaseHTTPRequestHandler):
   def do_GET(self):
    if self.path=="/pack":
     self.send_response(200)
     self.send_header("Content-Type","application/octet-stream")
     self.send_header("Content-Length",str(len(packed)))
     self.send_header("Access-Control-Allow-Origin","http://localhost:8123")
     self.send_header("Cache-Control","no-store")
     self.end_headers()
     self.wfile.write(packed)
     return
    if not self.path.startswith("/frame/"):self.send_error(404);return
    try:index=int(self.path.removeprefix("/frame/"))
    except ValueError:self.send_error(404);return
    if index<0 or index>=len(frames):self.send_error(404);return
    payload=frames[index].read_bytes()
    self.send_response(200)
    self.send_header("Content-Type","image/jpeg")
    self.send_header("Content-Length",str(len(payload)))
    self.send_header("Access-Control-Allow-Origin","http://localhost:8123")
    self.send_header("Cache-Control","no-store")
    self.send_header("X-Content-Type-Options","nosniff")
    self.end_headers()
    self.wfile.write(payload)
   def log_message(self,*args):pass
  server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True)
  thread.start()
  port=server.server_port
  browser=m.Socket(m.get("json/version")["webSocketDebuggerUrl"])
  target=None
  original=next((x for x in m.get("json/list") if x.get("type")=="page" and
    "c720p-hub/home" in x.get("url","")),None)
  try:
   target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})["targetId"]
   page=None
   for step in range(45):
    tab=next((x for x in m.get("json/list") if x.get("id")==target),None)
    if tab and tab.get("webSocketDebuggerUrl"):
     page=m.Socket(tab["webSocketDebuggerUrl"])
     page.sock.settimeout(90)
     break
    time.sleep(.25)
   if page is None:raise RuntimeError("chromium_test_tab_unavailable")
   try:
    browser.call("Target.activateTarget",{"targetId":target})
    expression=r"""(async()=>{
      const count=__COUNT__,port=__PORT__;
      const base='http://127.0.0.1:'+port;
      const offsets=__OFFSETS__;
      let bitmaps=[];
      try{
        const started=performance.now();
        const response=await fetch(base+'/pack',{cache:'no-store'});
        if(!response.ok)throw new Error('jpeg_pack_http_'+response.status);
        const packed=await response.arrayBuffer();
        if(packed.byteLength!==offsets[offsets.length-1])throw new Error('jpeg_pack_bounds');
        for(let start=0;start<count;start+=12){
          const segment=Array.from({length:Math.min(12,count-start)},(_,i)=>start+i);
          const batch=await Promise.all(segment.map(async i=>{
            const data=new Blob([packed.slice(offsets[i],offsets[i+1])],{type:'image/jpeg'});
            return createImageBitmap(data);
          }));
          bitmaps.push(...batch);
        }
        const decodeMs=performance.now()-started;
        let canvas=document.createElement('canvas');
        canvas.width=640;canvas.height=360;
        canvas.style.cssText='position:fixed;inset:40px auto auto 40px;width:480px;height:270px;z-index:2147483600;background:#111';
        document.body.append(canvas);
        const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
        const display=await new Promise(resolve=>{
          let started=0,last=-1,distinct=0,ticks=0,maxSlip=0;
          function step(ts){
            if(!started)started=ts;
            ticks++;
            const elapsed=ts-started;
            const wanted=Math.min(bitmaps.length-1,Math.floor(elapsed/40));
            maxSlip=Math.max(maxSlip,Math.max(0,wanted-last-1));
            if(wanted!==last){
              ctx.drawImage(bitmaps[wanted],0,0);
              last=wanted;distinct++;
            }
            if(elapsed>=Math.min((bitmaps.length-2)*40,5000)){
              resolve({presented_frames:distinct,seconds:elapsed/1000,
                unique_frame_fps:distinct*1000/elapsed,
                animation_callbacks:ticks,
                animation_fps:ticks*1000/elapsed,max_frame_skips:maxSlip,
                last_frame:last,available:bitmaps.length,decode_ms:decodeMs,
                canvas_size:[canvas.width,canvas.height]});
            }else requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        });
        canvas.remove();
        return display;
      }finally{
       for(const bitmap of bitmaps)bitmap.close();
      }
    })()""".replace("__COUNT__",str(len(frames))).replace("__PORT__",str(port)).replace("__OFFSETS__",json.dumps(offsets))
    answer=page.call("Runtime.evaluate",{"expression":expression,"awaitPromise":True,"returnByValue":True})
    value=answer.get("result",{}).get("value",answer)
    print("S9_C720P_JPEG_PILOT",json.dumps({"result":value,"source_bytes":src.stat().st_size,
      "source_decoder":meta.get("decoder"),"source_frames":len(frames),"source_index":int(os.environ.get("S9_JPEG_SOURCE_INDEX","0")),
      "private_loopback_only":True,"packed_bytes":len(packed),"production_ui_modified":False},sort_keys=True),flush=True)
   finally:page.close()
  finally:
   if original:
    try:browser.call("Target.activateTarget",{"targetId":original["id"]})
    except Exception:pass
   if target:
    try:browser.call("Target.closeTarget",{"targetId":target})
    except Exception:pass
   browser.close()
   server.shutdown()
if __name__=="__main__":main()
