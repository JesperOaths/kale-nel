#!/usr/bin/env python3
"""Temporary isolated Chromium media benchmark. Original kiosk tab restored."""
import importlib.util,json,time
from pathlib import Path
path=Path('/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py')
spec=importlib.util.spec_from_file_location('cdp_primitives',path)
lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
CLIP='motion_1791740141770.mp4'
BROWSER=lib.Socket(lib.get('json/version')['webSocketDebuggerUrl'])
target=None
old=next((x for x in lib.get('json/list') if x.get('type')=='page' and 'c720p-hub' in x.get('url','')),None)
try:
 target=BROWSER.call('Target.createTarget',{'url':'about:blank','background':True})['targetId']
 page=None
 for i in range(45):
  item=next((x for x in lib.get('json/list') if x.get('id')==target),None)
  if item and item.get('webSocketDebuggerUrl'):
   page=lib.Socket(item['webSocketDebuggerUrl']);break
  time.sleep(.22)
 if page is None:raise RuntimeError('isolated_page_missing')
 try:
  BROWSER.call('Target.activateTarget',{'targetId':target})
  script=r"""(async function(){
    const v=document.createElement('video');
    document.body.style='margin:0;background:#111;color:white';
    v.style='width:480px;height:270px;object-fit:contain;background:black';
    v.muted=true;v.playsInline=true;v.preload='auto';v.controls=true;
    document.body.append(v);
    const events=[],start=performance.now();
    for(const e of ['loadstart','playing','canplay','stalled','waiting','error'])
      v.addEventListener(e,()=>events.push({name:e,elapsedMs:performance.now()-start}));
    const url='http://localhost:8794/new/saved/clip/__CLIP__?playback=hub';
    v.src=url;
    let displayed=0,first=0,last=0;
    v.requestVideoFrameCallback(function cb(now,meta){
      displayed++;if(!first)first=now;last=now;
      if(v.isConnected)v.requestVideoFrameCallback(cb);
    });
    let error=null;
    try{await v.play();await new Promise(res=>setTimeout(res,7300))}
    catch(ex){error=String(ex)}
    const q=v.getVideoPlaybackQuality?.()||{};
    const sec=first?Math.max(0.001,(last-first)/1000):0;
    const result={visibility:document.visibilityState,width:v.videoWidth,height:v.videoHeight,
      videoCurrent:v.currentTime, videoPaused:v.paused,
      framesPresentedCallbacks:displayed,callbackFps:sec?displayed/sec:0,
      totalFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames,
      postDropFps:v.currentTime>0?((q.totalVideoFrames||0)-(q.droppedVideoFrames||0))/v.currentTime:0,
      errors:error,events};
    v.pause();v.removeAttribute('src');v.load();v.remove();
    return result;
  })()""".replace('__CLIP__',CLIP)
  result=page.call('Runtime.evaluate',{'expression':script,'returnByValue':True,'awaitPromise':True})
  print('S9_ISOLATED_CHROMIUM_480P_FPS',json.dumps(result.get('result',{}).get('value',result),sort_keys=True),flush=True)
 finally:page.close()
finally:
 if old:
  try:BROWSER.call('Target.activateTarget',{'targetId':old['id']})
  except Exception:pass
 if target:
  try:BROWSER.call('Target.closeTarget',{'targetId':target})
  except Exception:pass
 BROWSER.close()
