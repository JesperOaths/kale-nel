#!/usr/bin/env python3
"""S9 derived MP4 in blank Chromium tab, no Home Assistant dashboard DOM.
The pre-existing kiosk tab and camera are never modified; background tab
is removed after a bounded <15s test. Measure actually PRESENTED frames.
"""
import importlib.util,json,os,time,urllib.request
LIB="/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py"
spec=importlib.util.spec_from_file_location("s9_cdp",LIB)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def main():
 clip=os.environ.get("S9_TEST_CLIP","motion_1791739041453.mp4")
 assert clip in ("motion_1791739041453.mp4","motion_1791740141770.mp4")
 url="http://localhost:8794/new/saved/clip/"+clip+"?playback=hub"
 b=mod.Socket(mod.get("json/version")["webSocketDebuggerUrl"])
 target=None
 try:
  target=b.call("Target.createTarget",{"url":"about:blank","background":True})["targetId"]
  tab=None
  for i in range(30):
   x=next((a for a in mod.get("json/list") if a.get("id")==target),None)
   if x and x.get("webSocketDebuggerUrl"):
    tab=mod.Socket(x["webSocketDebuggerUrl"])
    tab.sock.settimeout(48)
    break
   time.sleep(.3)
  if not tab:raise RuntimeError("temporary_video_tab_missing")
  try:
   b.call("Target.activateTarget",{"targetId":target})
   js="""(async()=>{
    const video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.controls=false;
    video.style.cssText='position:fixed;inset:10px;width:640px;height:360px';
    document.body.append(video);
    let seen=0,first=0,last=0,events=[];
    for(const event of ['playing','waiting','stalled','error'])
      video.addEventListener(event,()=>events.push(event));
    const cb=(now,meta)=>{seen++;if(!first)first=now;last=now;
      if(video.isConnected)video.requestVideoFrameCallback(cb)};
    video.requestVideoFrameCallback(cb);
    video.src=__SOURCE__;
    let error='';
    try{
      await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('play_timeout')),7000))]);
      await new Promise(resolve=>setTimeout(resolve,7000));
    }catch(e){error=String(e)}
    const duration=Math.max(.001,(last-first)/1000);
    const q=video.getVideoPlaybackQuality?.();
    const result={fps:first?seen/duration:0,frames:seen,videoWidth:video.videoWidth,
      videoHeight:video.videoHeight,dropped:q?.droppedVideoFrames,
      mediaTime:video.currentTime,events,error,source:video.currentSrc.slice(0,110)};
    video.pause();video.removeAttribute('src');video.load();video.remove();return result;
   })()""".replace("__SOURCE__",json.dumps(url))
   r=tab.call("Runtime.evaluate",{"expression":js,"returnByValue":True,"awaitPromise":True})
   d=r.get("result",{}).get("value")
   if not isinstance(d,dict):raise RuntimeError("CDP_result_missing_"+str(r)[:200])
   print("S9_STANDALONE_MINIMAL_VIDEO_DISPLAY_FPS",json.dumps({"clip":clip,**d},sort_keys=True),flush=True)
  finally:tab.close()
 finally:
  if target:b.call("Target.closeTarget",{"targetId":target})
  b.close()
if __name__=="__main__":main()
