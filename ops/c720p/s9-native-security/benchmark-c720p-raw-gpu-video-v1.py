#!/usr/bin/env python3
"""S9 derived-video playback feasibility: C720P WebGL RGB565 frames at 25 FPS.

Uses a 5-second 360p cached derived clip; FFmpeg converts that clip into
480x270 RGB565 just once. Browser test uploads 259,200 bytes per frame
to WebGL, bypassing H.264/JPEG software decoders during playback.
Temporary localhost-only HTTP server and Chromium tab are removed afterward.
"""
import importlib.util,json,os,pathlib,subprocess,tempfile,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

W,H,FPS=480,270,25
BYTES_PER_FRAME=W*H*2
CDP="/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py"
def cdplib():
 spec=importlib.util.spec_from_file_location("framepilot_cdp",CDP)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def raw_clip(tmp):
 sources=[]
 for meta in pathlib.Path("/tmp/c720p-security-playback").glob("*.json"):
  try:
   data=json.loads(meta.read_text());v=meta.with_suffix(".mp4")
   if data.get("profile")=="360p30" and v.exists() and v.stat().st_size>20000:
    sources.append((meta.stat().st_mtime,v,data))
  except (OSError,ValueError):pass
 sources.sort(reverse=True)
 index=int(os.environ.get("S9_RAW_SOURCE_INDEX","0"))
 if index<0 or index>=min(len(sources),5):raise RuntimeError("derived_source_not_available")
 original=sources[index][1]
 target=tmp/"frames.rgb565"
 cmd=["/usr/bin/nice","-n","12","ffmpeg","-nostdin","-hide_banner","-v","error","-y",
  "-i",str(original),"-t","5.1","-vf",f"fps={FPS},scale={W}:{H},format=rgb565le",
  "-pix_fmt","rgb565le","-f","rawvideo",str(target)]
 result=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=100)
 if result.returncode:raise RuntimeError("rgb565_extract_failed_"+result.stderr.decode(errors="replace")[-200:])
 size=target.stat().st_size
 if size%BYTES_PER_FRAME:raise RuntimeError("rgb565_frame_alignment")
 count=size//BYTES_PER_FRAME
 if count<90 or count>140:raise RuntimeError("invalid_raw_frame_count")
 return target,count,original,sources[index][2]
def main():
 m=cdplib()
 with tempfile.TemporaryDirectory(prefix="s9-c720p-rgb565-") as temp:
  directory=pathlib.Path(temp)
  data,count,source,profile=raw_clip(directory)
  class Handler(BaseHTTPRequestHandler):
   def do_GET(self):
    if self.path!="/pack":self.send_error(404);return
    self.send_response(200)
    self.send_header("Content-Type","application/octet-stream")
    self.send_header("Content-Length",str(data.stat().st_size))
    self.send_header("Cache-Control","no-store")
    self.send_header("Access-Control-Allow-Origin","http://localhost:8123")
    self.end_headers()
    with data.open("rb") as f:
     try:
      while True:
       block=f.read(262144)
       if not block:break
       self.wfile.write(block)
     except (BrokenPipeError,ConnectionResetError):pass
   def log_message(self,*a):pass
  server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
  worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
  browser=m.Socket(m.get("json/version")["webSocketDebuggerUrl"])
  original_tab=next((x for x in m.get("json/list") if x.get("type")=="page" and
     "c720p-hub/home" in x.get("url","")),None)
  target=None
  try:
   target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})["targetId"]
   page=None
   for i in range(40):
    d=next((x for x in m.get("json/list") if x.get("id")==target),None)
    if d and d.get("webSocketDebuggerUrl"):
     page=m.Socket(d["webSocketDebuggerUrl"]);page.sock.settimeout(70);break
    time.sleep(.25)
   if page is None:raise RuntimeError("browser_test_tab_missing")
   try:
    browser.call("Target.activateTarget",{"targetId":target})
    script=r"""(async()=>{
      const port=__PORT__,count=__COUNT__,w=480,h=270,fps=25;
      const started=performance.now();
      const response=await fetch('http://127.0.0.1:'+port+'/pack',{cache:'no-store'});
      if(!response.ok)throw Error('raw_pack_http_'+response.status);
      const raw=await response.arrayBuffer();
      if(raw.byteLength!==count*w*h*2)throw Error('raw_frame_alignment');
      const downloadMs=performance.now()-started;
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      canvas.style.cssText='position:fixed;z-index:2147483600;top:40px;left:40px;width:480px;height:270px;background:black';
      document.body.append(canvas);
      const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
      if(!gl)throw Error('chromium_webgl_unavailable');
      const vsrc='attribute vec2 a; varying vec2 v; void main(){v=(a+1.0)*0.5;gl_Position=vec4(a,0.0,1.0);}';
      const fsrc='precision mediump float;varying vec2 v;uniform sampler2D img;void main(){gl_FragColor=texture2D(img,vec2(v.x,1.0-v.y));}';
      function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('shader_compile_'+gl.getShaderInfoLog(s));return s}
      const program=gl.createProgram();
      gl.attachShader(program,shader(gl.VERTEX_SHADER,vsrc));
      gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fsrc));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('gl_link');
      gl.useProgram(program);
      const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      let stats=await new Promise(resolve=>{
        let start=0,last=-1,updates=0,ticks=0,skipped=0;
        function frame(timestamp){
          if(!start)start=timestamp;
          const elapsed=timestamp-start;
          const wanted=Math.min(count-1,Math.floor(elapsed/(1000/fps)));
          ticks++;
          if(wanted!==last){
            if(last>=0)skipped+=Math.max(0,wanted-last-1);
            const src=new Uint16Array(raw,wanted*w*h*2,w*h);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,w,h,0,gl.RGB,gl.UNSIGNED_SHORT_5_6_5,src);
            gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
            last=wanted;updates++;
          }
          if(elapsed>=Math.min((count-2)*1000/fps,5000))resolve({
            fps:updates*1000/elapsed,displayed_frames:updates,
            elapsed_seconds:elapsed/1000,skipped_positions:skipped,
            rAF_fps:ticks*1000/elapsed,rendered_to:'WebGL_RGB565',
            initial_download_ms:downloadMs,input_frames:count,
            gl_error:gl.getError()
          });
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      canvas.remove();
      return stats;
    })()""".replace("__PORT__",str(server.server_port)).replace("__COUNT__",str(count))
    r=page.call("Runtime.evaluate",{"expression":script,"awaitPromise":True,"returnByValue":True})
    value=r.get("result",{}).get("value")
    if value is None:raise RuntimeError("webgl_benchmark_eval_failed_"+str(r)[:400])
    print("S9_C720P_RAW_GPU_VIDEO_PILOT",json.dumps({
       "results":value,"frame_count":count,"frame_bytes":BYTES_PER_FRAME,
       "source_index":int(os.environ.get("S9_RAW_SOURCE_INDEX","0")),
       "source_decoder":profile.get("decoder"),"pilot_bytes":data.stat().st_size,
       "production_modified":False,"private_loopback_only":True},sort_keys=True),flush=True)
   finally:page.close()
  finally:
   if original_tab:
    try:browser.call("Target.activateTarget",{"targetId":original_tab["id"]})
    except Exception:pass
   if target:
    try:browser.call("Target.closeTarget",{"targetId":target})
    except Exception:pass
   browser.close()
   server.shutdown()
if __name__=="__main__":main()
