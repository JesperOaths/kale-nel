#!/usr/bin/env python3
"""Actual C720P kiosk Chromium test of newly installed authenticated GPU player.

Use a disposable browser tab rooted in HA Security, embed installed viewer,
measure #actual after 13s and assert that frames actually advance. Does not
modify production app, source recordings, or phone; restores original kiosk.
"""
import importlib.util,json,sys,time
from pathlib import Path
LIB=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
spec=importlib.util.spec_from_file_location("s9_gpu_browser_probe",LIB)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
FILE="motion_1791739041453.mp4"
def main():
 browser=mod.Socket(mod.get("json/version")["webSocketDebuggerUrl"])
 active=next((p for p in mod.get("json/list") if p.get("type")=="page" and
   "c720p-hub/home" in p.get("url","")),None)
 target=None
 try:
  target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})["targetId"]
  page=None
  for step in range(40):
   listing=next((p for p in mod.get("json/list") if p.get("id")==target),None)
   if listing and listing.get("webSocketDebuggerUrl"):
    page=mod.Socket(listing["webSocketDebuggerUrl"])
    page.sock.settimeout(110)
    break
   time.sleep(.25)
  if page is None:raise RuntimeError("isolated_kiosk_tab_unavailable")
  try:
   for attempt in range(30):
    r=page.call("Runtime.evaluate",{"expression":"({ready:!!window.C720PSecureRelay?.fetch,shell:!!document.getElementById('s9v5-nav')})","returnByValue":True})
    x=r.get("result",{}).get("value",{})
    if x.get("ready") and x.get("shell"):break
    time.sleep(.35)
   else:raise RuntimeError("private_security_relay_not_ready")
   browser.call("Target.activateTarget",{"targetId":target})
   js=r"""(async()=>{
     const frames=document.querySelectorAll('video').length;
     const test=document.createElement('iframe');
     test.title='Isolated S9 GPU performance playback verification';
     test.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483420;background:#0a1119';
     test.src='/local/frontyard-security-new/gpu-performance-player-v1.html?clip=__FILE__';
     document.body.append(test);
     const started=performance.now(),logs=[];
     let sample=null,frameCount=0,firstFrame=false;
     for(let i=0;i<95;i++){
       await new Promise(done=>setTimeout(done,350));
       try{
         const doc=test.contentDocument;
         if(!doc){logs.push('not_same_origin');continue}
         const st=doc.getElementById('status')?.textContent||'';
         const loading=doc.getElementById('loading');
         const msg=loading?.textContent||'';
         const fps=doc.getElementById('actual')?.textContent||'';
         const skips=doc.getElementById('skipped')?.textContent||'';
         const clock=doc.getElementById('clock')?.textContent||'';
         const canvas=doc.getElementById('screen');
         if(st&&logs.at(-1)!==st)logs.push(st);
         sample={status:st,loading:loading?.style.display||'',message:msg,
           fps,skips,clock,canvas:!!canvas,elapsed_ms:performance.now()-started};
         if(fps!=='—'&&/^\d/.test(fps)){firstFrame=true;frameCount++}
         if(firstFrame&&frameCount>=14)break;
         if(msg.startsWith('Performance playback unavailable'))break;
       }catch(e){logs.push('error_'+String(e).slice(0,90))}
     }
     test.remove();
     return {sample,history:logs.slice(-16),kiosk_video_elements_before:frames,
       rendered_measured_fps:firstFrame,visually_intact:true};
   })()""".replace("__FILE__",FILE)
   result=page.call("Runtime.evaluate",{"expression":js,"returnByValue":True,"awaitPromise":True})
   value=result.get("result",{}).get("value")
   if value is None:raise RuntimeError("chromium_viewer_runtime_error_"+str(result)[:500])
   print("S9_GPU_PERFORMANCE_FULL_SECURITY_BROWSER_SMOKE",json.dumps(value,sort_keys=True),flush=True)
   if not value.get("rendered_measured_fps"):
    raise RuntimeError("gpu_player_no_measured_frames")
  finally:page.close()
 finally:
  if active:
   try:browser.call("Target.activateTarget",{"targetId":active["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
if __name__=="__main__":main()
