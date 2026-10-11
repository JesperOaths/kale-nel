#!/usr/bin/env python3
"""Benchmark real V8 Evidence iframe video on kiosk, restoring original tab."""
import importlib.util,json,time
from pathlib import Path
P=Path('/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py')
spec=importlib.util.spec_from_file_location('cdpv8',P)
lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
browser=lib.Socket(lib.get('json/version')['webSocketDebuggerUrl'])
target=None;page=None
orig=next((x for x in lib.get('json/list') if x.get('type')=='page' and 'c720p-hub' in x.get('url','')),None)
try:
 target=browser.call('Target.createTarget',{'url':'http://localhost:8123/local/c720p-surveillance.html','background':True})['targetId']
 for i in range(45):
  d=next((x for x in lib.get('json/list') if x.get('id')==target),None)
  if d and d.get('webSocketDebuggerUrl'):
   page=lib.Socket(d['webSocketDebuggerUrl']);break
  time.sleep(.25)
 if page is None:raise RuntimeError('security_browser_tab_not_ready')
 browser.call('Target.activateTarget',{'targetId':target})
 expr=r"""(async function(){
  const wait=async (fn,seconds=16)=>{
   const until=performance.now()+seconds*1000;
   while(performance.now()<until){const value=fn();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,250))}
   throw new Error('timeout_waiting_for_security_view')};
  const button=await wait(()=>document.querySelector('#s9v5-nav button[data-view=evidence]'));
  button.click();
  const iframe=await wait(()=>document.querySelector('#s9v8-evidence iframe'));
  const documentInside=await wait(()=>{
    const doc=iframe.contentDocument;
    return doc?.querySelector('#list .clip')?doc:null;
  },28);
  const find=documentInside.getElementById('search');
  find.value='motion_1791740141770.mp4';
  find.dispatchEvent(new Event('input',{bubbles:true}));
  const card=await wait(()=>documentInside.querySelector('#list .clip'));
  card.click();
  const v=await wait(()=>documentInside.querySelector('#detail video'));
  v.muted=true;v.playsInline=true;v.autoplay=false;
  const events=[];
  for(const name of ['loadedmetadata','playing','waiting','error','canplay'])
    v.addEventListener(name,()=>events.push(name));
  let frames=0,first=0,last=0,failed='';
  v.requestVideoFrameCallback(function callback(now,info){
   frames++;if(!first)first=now;last=now;
   if(v.isConnected)v.requestVideoFrameCallback(callback)
  });
  try{await v.play();await new Promise(resolve=>setTimeout(resolve,6900))}
  catch(error){failed=String(error)}
  const q=v.getVideoPlaybackQuality?.()||{};
  const sec=first?Math.max(.001,(last-first)/1000):0;
  const result={clip:card.dataset.clip,
    iframeVisible:document.visibilityState,
    iframeDocumentLoaded:documentInside.readyState,
    frames,displayedFps:sec?frames/sec:0,
    mediaTime:v.currentTime,paused:v.paused,
    resolution:[v.videoWidth,v.videoHeight],
    dropped:q.droppedVideoFrames,total:q.totalVideoFrames,
    browserQualityFps:v.currentTime>0?((q.totalVideoFrames||0)-(q.droppedVideoFrames||0))/v.currentTime:0,
    events,failed};
  v.pause();v.removeAttribute('src');v.load();
  return result;
 })()"""
 r=page.call('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True})
 print('S9_REAL_EVIDENCE_IFRAME_PLAYBACK',json.dumps(r.get('result',{}).get('value',r),sort_keys=True),flush=True)
finally:
 if page:page.close()
 if orig:
  try:browser.call('Target.activateTarget',{'targetId':orig['id']})
  except Exception:pass
 if target:
  try:browser.call('Target.closeTarget',{'targetId':target})
  except Exception:pass
 browser.close()
