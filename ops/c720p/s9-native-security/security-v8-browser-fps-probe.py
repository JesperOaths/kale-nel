#!/usr/bin/env python3
"""Temporary authenticated kiosk browser tab video playback performance sampling.

Returns the hub to its original active tab after a bounded short 4K test.
Does not record video, touch camera controls or change hub browser settings.
"""
import importlib.util,json,time,urllib.request
from pathlib import Path
LIB=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
spec=importlib.util.spec_from_file_location("security_cdp",LIB)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def evaluate(page,script,wait=False):
 return page.call("Runtime.evaluate",{"expression":script,"returnByValue":True,"awaitPromise":wait})["result"]
def main():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:archive=json.load(r)
 clips=sorted((str(x.get("clip_no","")) for x in archive["events"] if str(x.get("clip_no","")).startswith("motion_")),reverse=True)
 if not clips:raise RuntimeError("no_native_clips_for_probe")
 clip=clips[0]
 browser=mod.Socket(mod.get("json/version")["webSocketDebuggerUrl"])
 original=next((x for x in mod.get("json/list") if x.get("type")=="page" and "c720p-hub" in x.get("url","")),None)
 target=None
 try:
  target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})["targetId"]
  tab=None
  for i in range(40):
   d=next((x for x in mod.get("json/list") if x.get("id")==target),None)
   if d and d.get("webSocketDebuggerUrl"):tab=mod.Socket(d["webSocketDebuggerUrl"]);break
   time.sleep(.25)
  if tab is None:raise RuntimeError("CDP_background_tab_missing")
  try:
   feature={}
   for i in range(20):
    res=evaluate(tab,"({url:location.href,secureRelay:!!window.C720PSecureRelay,secureUrl:typeof window.C720PSecureRelay?.url,frameCallback:!!HTMLVideoElement.prototype.requestVideoFrameCallback,ready:!!document.getElementById('s9v5-nav')})")
    feature=res.get("value") or {}
    if feature.get("ready") and feature.get("secureRelay"):break
    time.sleep(.5)
   print("S9_BROWSER_MEDIA_FEATURES",json.dumps(feature),flush=True)
   if not feature.get("secureRelay") or feature.get("secureUrl")!="function":
    raise RuntimeError("authenticated_video_relay_unavailable_in_browser")
   if not feature.get("frameCallback"):raise RuntimeError("browser_lacks_video_frame_callback")
   # Make a bounded 8-second visible video test in the temporary Security tab.
   # The 1,920px-wide 4K source remains unmodified on the S9+.
   browser.call("Target.activateTarget",{"targetId":target})
   script="""(async()=>{
    const clip=__CLIP__;
    const url=await window.C720PSecureRelay.url('/new/saved/clip/'+clip);
    const v=document.createElement('video');
    v.muted=true;v.playsInline=true;v.preload='auto';v.controls=false;
    v.style.cssText='position:fixed;z-index:2147483600;bottom:0;right:0;width:480px;height:270px;object-fit:contain;background:#000';
    document.body.appendChild(v);
    v.src=url;
    const start=performance.now(),seen=[],errors=[],events=[];
    for(const e of ['loadstart','waiting','loadedmetadata','canplay','playing','stalled','suspend','emptied','error'])
      v.addEventListener(e,()=>events.push({event:e,at:Math.round(performance.now()-start),code:v.error?.code||null}),{once:false});
    let signedURL={length:String(url).length,starts:String(url).slice(0,130)};
    let fetchProbe={};
    try{
      const fetched=await window.C720PSecureRelay.fetch('/new/saved/clip/'+clip,{method:'GET',headers:{Range:'bytes=0-1023'}});
      const bytes=await fetched.arrayBuffer();
      fetchProbe={ok:fetched.ok,http:fetched.status,bytes:bytes.byteLength,type:fetched.headers.get('Content-Type')};
    }catch(e){fetchProbe={error:String(e)};}
    let frames=0;let firstVideoFrame=0;let lastVideoFrame=0;
    const cb=(now,m)=>{frames++;if(!firstVideoFrame)firstVideoFrame=now;lastVideoFrame=now;seen.push(m.mediaTime);if(v.isConnected)v.requestVideoFrameCallback(cb)};
    v.requestVideoFrameCallback(cb);
    try{await Promise.race([v.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('play_timeout')),4000))]);
      await new Promise(resolve=>setTimeout(resolve,8500));}
    catch(err){errors.push(String(err))}
    const q=v.getVideoPlaybackQuality?.();
    const secs=firstVideoFrame?Math.max(.001,(lastVideoFrame-firstVideoFrame)/1000):0;
    const result={clip,frames,span_seconds:secs,observed_fps:secs?frames/secs:0,
      currentTime:v.currentTime,videoWidth:v.videoWidth,videoHeight:v.videoHeight,
      droppedFrames:q?.droppedVideoFrames,totalFrames:q?.totalVideoFrames,
      readyState:v.readyState,networkState:v.networkState,errors,
      mediaTimeFirst:seen[0]??null,mediaTimeLast:seen.at(-1)??null,
      duration_ms:performance.now()-start,events,fetchProbe,signedURL,
      mediaError:v.error?.message??null,isConnected:v.isConnected,
      srcLength:String(v.currentSrc||v.src).length,paused:v.paused,
      sourceUrlStart:String(v.currentSrc||v.src).slice(0,135),
      mediaCapabilities:typeof navigator.mediaCapabilities};
    v.pause();v.removeAttribute('src');v.load();v.remove();
    return result;
   })()""".replace("__CLIP__",json.dumps(clip))
   r=evaluate(tab,script,True)
   print("S9_REAL_KIOSK_4K_PLAYBACK_PERF",json.dumps(r.get("value",r),sort_keys=True),flush=True)
  finally:
   tab.close()
 finally:
  if original:
   try:browser.call("Target.activateTarget",{"targetId":original["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
if __name__=="__main__":main()
