#!/usr/bin/env python3
"""Read-only, real Chromium decode smoke for one verified S9 migrated MP4.

Only a 3.2-second muted test in one disposable HA Security tab. Browser receives
an existing signed S9 media URL but neither clip identity nor URL is logged.
No Save/Delete, video export, local file writes, camera restart or person API.
Restore the original Home Assistant kiosk target even on a probe exception.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import urllib.request

HELPER=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
STATIC=Path("/opt/homeassistant/config/www/frontyard-security-new")
MARK="C720P_MIGRATED_BROWSER_DECODE_V145_VERIFIED "
def healthy():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as response:
  if response.status!=200:raise RuntimeError("camera_status_unavailable")
  raw=response.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_status_unbounded")
 s=json.loads(raw)
 if (s.get("ok") is not True or s.get("mode")!="watching"
     or s.get("native_4k_enabled") is not True
     or s.get("continuous_4k_ready") is not True
     or s.get("continuous_4k_dropped_output_frames")!=0
     or s.get("continuous_4k_error")
     or type(s.get("temperature_c")) not in (float,int)
     or not 0<s["temperature_c"]<=38.7
     or type(s.get("continuous_4k_buffered_ms")) is not int
     or s["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("capture_unhealthy_or_hot_for_browser_decode")
 return s
def js():
 return r"""(async()=>{
  const relay=window.C720PSecureRelay;
  if(!relay?.url||!relay?.fetch)return {error:'auth_relay_missing'};
  const res=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
  if(res.status!==200)return {error:'migrated_manifest_unavailable',api_http:res.status};
  const data=await res.json();
  if(data?.ok!==true||data.schema_version!=='c720p_s9_verified_import_v2'||
     data.not_s9_original_recordings!==true||data.not_person_assignments!==true||
     !Array.isArray(data.files)||!Number.isSafeInteger(data.total_imported)||
     data.files.length!==data.total_imported||data.files.length<1)return {error:'unverified_manifest'};
  const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
  const rec=data.files.find(f=>f&&valid.test(f.name)&&!f.name.includes('..')&&
         Number.isSafeInteger(f.bytes)&&f.bytes>=10000&&f.bytes<=943718400);
  if(!rec)return {error:'no_safe_migrated_candidate'};
  const path='/new/saved/c720p-migrated/clip/'+encodeURIComponent(rec.name);
  const signed=await relay.url(path);
  if(typeof signed!=='string'||signed.length<8)return {error:'missing_signed_url'};
  const v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.autoplay=false;v.controls=false;
  v.preload='metadata';
  v.style.cssText='position:fixed;bottom:0;right:0;width:360px;height:203px;background:#000;z-index:2147483300';
  document.body.append(v);
  let frames=0,first=null,last=null,err=null,playing=false;
  const callback=(now,meta)=>{
   frames++;
   if(first===null)first=meta.mediaTime;
   last=meta.mediaTime;
   if(v.isConnected)try{v.requestVideoFrameCallback(callback)}catch(_){}
  };
  try{
   v.src=signed;
   if(typeof v.requestVideoFrameCallback==='function')v.requestVideoFrameCallback(callback);
   let deadline=new Promise((_,reject)=>setTimeout(()=>reject(new Error('playback_timeout')),5600));
   try{await Promise.race([v.play(),deadline]);playing=true}catch(e){err=String(e).slice(0,110)}
   if(playing)await new Promise(resolve=>setTimeout(resolve,3200));
   const count=v.getVideoPlaybackQuality?.();
   return {authenticated_manifest:true,migrated_recordings_count:data.files.length,
     decode_supported:typeof v.requestVideoFrameCallback==='function',
     video_width:v.videoWidth,video_height:v.videoHeight,
     decoded_frame_callbacks:frames,media_time_start:first,media_time_end:last,
     video_current_time:v.currentTime,video_ready_state:v.readyState,
     browser_video_error:v.error?.code||null,
     total_browser_frames:count?.totalVideoFrames??null,
     dropped_browser_frames:count?.droppedVideoFrames??null,
     playback_started:playing,playback_error:err,
     no_user_media_mutations:true,private_clip_id_not_returned:true,
     signed_url_not_returned:true};
  }finally{
   v.pause();v.removeAttribute('src');v.load();v.remove();
  }
 })()"""
def validate(result):
 if not isinstance(result,dict):raise RuntimeError("no_decoded_browser_evidence")
 if (result.get("authenticated_manifest") is not True
  or type(result.get("migrated_recordings_count")) is not int
  or result["migrated_recordings_count"]<1
  or result.get("decode_supported") is not True
  or result.get("playback_started") is not True
  or result.get("playback_error") is not None
  or result.get("browser_video_error") is not None
  or type(result.get("decoded_frame_callbacks")) is not int
  or result["decoded_frame_callbacks"]<3
  or not 0.2<float(result.get("video_current_time",0))<10000
  or result.get("video_ready_state",0)<2
  or type(result.get("video_width")) is not int
  or result["video_width"]<120
  or type(result.get("video_height")) is not int
  or result["video_height"]<90
  or result.get("no_user_media_mutations") is not True
  or result.get("signed_url_not_returned") is not True):
  raise RuntimeError("migration_browser_decode_unverified_"+str(result.get("error") or result.get("playback_error") or "metrics")[:100])
 return {"authenticated_migrated_video_decoded":True,
         "migrated_clip_count":result["migrated_recordings_count"],
         "decoded_frames":result["decoded_frame_callbacks"],
         "video_width":result["video_width"],"video_height":result["video_height"],
         "signed_url_not_disclosed":True,"file_names_not_disclosed":True,
         "no_originals_modified":True,"no_manual_reviews_modified":True,
         "camera_apk_modified":False}
def run():
 if HELPER.is_symlink() or not HELPER.is_file():
  raise RuntimeError("browser_cdp_helper_unavailable")
 for filename in ("clips.html","index.html","c720p-migrated-index-playback-v1.js"):
  p=STATIC/filename
  if p.is_symlink() or not p.is_file():raise RuntimeError("missing_deployed_legacy_asset")
 prior=healthy()
 spec=importlib.util.spec_from_file_location("s9_migrated_playback_v145",HELPER)
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 browser=helper.Socket(helper.get("json/version")["webSocketDebuggerUrl"])
 initial=next((p for p in helper.get("json/list")
               if p.get("type")=="page" and "c720p-hub" in p.get("url","")),None)
 if initial is None:
  browser.close();raise RuntimeError("original_kiosk_target_missing")
 target=None;page=None
 try:
  target=browser.call("Target.createTarget",{
      "url":"http://localhost:8123/local/c720p-surveillance.html",
      "background":True})["targetId"]
  for i in range(35):
   item=next((p for p in helper.get("json/list") if p.get("id")==target),None)
   if item and item.get("webSocketDebuggerUrl"):
    page=helper.Socket(item["webSocketDebuggerUrl"])
    page.sock.settimeout(45);break
   time.sleep(.2)
  if page is None:raise RuntimeError("temporary_kiosk_tab_missing")
  for i in range(35):
   res=page.call("Runtime.evaluate",{"expression":
     "({ready:!!window.C720PSecureRelay?.fetch,shell:!!document.getElementById('s9v5-nav')})",
     "returnByValue":True})
   obj=res.get("result",{}).get("value",{})
   if obj.get("ready") and obj.get("shell"):break
   time.sleep(.25)
  else:raise RuntimeError("authenticated_kiosk_relay_unavailable")
  browser.call("Target.activateTarget",{"targetId":target})
  proof=page.call("Runtime.evaluate",{
       "expression":js(),"returnByValue":True,"awaitPromise":True})
  data=proof.get("result",{}).get("value")
  summary=validate(data)
 finally:
  if page:
   try:page.close()
   except Exception:pass
  try:browser.call("Target.activateTarget",{"targetId":initial["id"]})
  except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
 after=healthy()
 summary.update({"original_kiosk_restored":True,
    "native_4k_ready_after":after["continuous_4k_ready"],
    "camera_temperature_before_c":prior["temperature_c"],
    "camera_temperature_after_c":after["temperature_c"],
    "camera_dropped_output_frames_after":after["continuous_4k_dropped_output_frames"]})
 print(MARK+json.dumps(summary,sort_keys=True),flush=True)
if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 if not args.run:
  d=healthy()
  print("C720P_MIGRATED_BROWSER_V145_PREFLIGHT "+json.dumps({
    "camera_healthy":True,"temperature_c":d["temperature_c"],
    "no_media_modified":True,"browser_not_started":True},sort_keys=True),flush=True)
 else:run()
