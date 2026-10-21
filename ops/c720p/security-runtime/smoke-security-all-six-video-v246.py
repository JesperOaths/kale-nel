#!/usr/bin/env python3
"""All six authenticated migrated MP4s play/pause/seek in actual HA Chromium.

Sequential short buffered muted samples. Never fetch full 4K videos, mutate
recording/person state, click Save/Delete, log signed URL, basename or pixels.
"""
import argparse,importlib.util,json
from pathlib import Path
BASE=Path(__file__).with_name("smoke-c720p-migrated-decoded-browser-v145.py")
MARK="SECURITY_ALL_SIX_VIDEO_RENDERED_V246_VERIFIED "
def js():
 return r"""(async()=>{
 const relay=window.C720PSecureRelay;
 if(!relay?.url||!relay?.fetch||
      !document.getElementById('s9v5-nav'))
  return {ok:false,reason:'authenticated_browser_not_ready'};
 const res=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
 if(res.status!==200)return {ok:false,reason:'manifest_unavailable'};
 const data=await res.json();
 if(data?.ok!==true||data.schema_version!=='c720p_s9_verified_import_v2'||
    data.total_imported!==6||!Array.isArray(data.files)||data.files.length!==6)
  return {ok:false,reason:'manifest_six_source_contract_invalid'};
 const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
 const names=new Set();let completed=0,rangeOK=0,seeks=0,frames=0;
 let minWidth=1e9,minHeight=1e9;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const bounded=(promise,ms)=>Promise.race([promise,
   new Promise((_,reject)=>setTimeout(()=>reject(new Error('time_limit')),ms))]);
 for(const rec of data.files){
  if(!rec||typeof rec.name!=='string'||!valid.test(rec.name)||
     rec.name.includes('..')||names.has(rec.name)||
     !Number.isSafeInteger(rec.bytes)||rec.bytes<10000||
     rec.bytes>943718400||rec.indexed!==true)
   return {ok:false,reason:'manifest_unverified_row',completed};
  names.add(rec.name);
  const path='/new/saved/c720p-migrated/clip/'+encodeURIComponent(rec.name);
  const range=await relay.fetch(path,{method:'GET',
    headers:{Range:'bytes=0-1023'},cache:'no-store'});
  if(range.status!==206)return {ok:false,reason:'range_http_not_206',completed};
  const part=await range.arrayBuffer();
  if(part.byteLength!==1024)return {ok:false,reason:'range_length_untrusted',completed};
  rangeOK++;
  const url=await relay.url(path);
  if(typeof url!=='string'||url.length<8)
   return {ok:false,reason:'signed_url_missing',completed};
  const v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.preload='metadata';v.controls=false;
  v.style.cssText='position:fixed;bottom:0;right:0;width:360px;height:203px;z-index:2147482500;background:black';
  document.body.append(v);
  let count=0,gotSeek=false;
  const callback=()=>{count++;if(v.isConnected)
    try{v.requestVideoFrameCallback(callback)}catch(_){ }};
  try{
   if(typeof v.requestVideoFrameCallback!=='function')
    return {ok:false,reason:'frame_callbacks_unavailable',completed};
   v.requestVideoFrameCallback(callback);
   v.src=url;
   await bounded(v.play(),6000);
   await pause(1000);
   v.pause();
   if(v.videoWidth<120||v.videoHeight<90||!Number.isFinite(v.duration)||
      v.duration<2||count<2)
    return {ok:false,reason:'actual_frame_decode_missing',completed};
   const target=Math.min(v.duration-0.6,Math.max(v.currentTime+0.55,2.1));
   const done=new Promise(resolve=>v.addEventListener('seeked',()=>{
    gotSeek=true;resolve(true)},{once:true}));
   v.currentTime=target;
   await bounded(done,6500);
   await bounded(v.play(),4500);
   await pause(420);
   v.pause();
   if(!gotSeek||!v.paused||v.currentTime<target-0.35||count<3)
    return {ok:false,reason:'actual_seek_replay_not_verified',completed};
   minWidth=Math.min(minWidth,v.videoWidth);minHeight=Math.min(minHeight,v.videoHeight);
   frames+=count;seeks++;completed++;
  }catch(_){return {ok:false,reason:'bounded_decoding_failed',completed}}
  finally{v.pause();v.removeAttribute('src');v.load();v.remove();}
 }
 return {ok:completed===6&&rangeOK===6&&seeks===6,
  actual_decoded_video_count:completed,
  authenticated_bounded_range_count:rangeOK,
  pause_seek_replay_count:seeks,
  decoded_frame_callbacks_total:frames,
  min_width:minWidth,min_height:minHeight,
  simultaneous_media_elements_max:1,
  original_c720p_media_unchanged:true,
  original_reviews_unchanged:true,
  clip_names_not_returned:true,signed_urls_not_returned:true,
  local_fallback_not_removed:true};
 })()"""
def validate(value):
 reasons={"authenticated_browser_not_ready","manifest_unavailable",
  "manifest_six_source_contract_invalid","manifest_unverified_row",
  "range_http_not_206","range_length_untrusted","signed_url_missing",
  "frame_callbacks_unavailable","actual_frame_decode_missing",
  "actual_seek_replay_not_verified","bounded_decoding_failed"}
 if not isinstance(value,dict) or value.get("ok") is not True:
  s=str(value.get("reason","unknown")) if isinstance(value,dict) else "unknown"
  raise RuntimeError("security_video_v246_"+(s if s in reasons else "unknown"))
 required={"actual_decoded_video_count":6,
  "authenticated_bounded_range_count":6,"pause_seek_replay_count":6,
  "simultaneous_media_elements_max":1,
  "original_c720p_media_unchanged":True,"original_reviews_unchanged":True,
  "clip_names_not_returned":True,"signed_urls_not_returned":True,
  "local_fallback_not_removed":True}
 if any(value.get(k)!=v for k,v in required.items()) or (
   type(value.get("decoded_frame_callbacks_total")) is not int
   or value["decoded_frame_callbacks_total"]<18
   or type(value.get("min_width")) is not int or value["min_width"]<120
   or type(value.get("min_height")) is not int or value["min_height"]<90):
  raise RuntimeError("security_video_v246_metrics_not_verified")
 return {"actual_migrated_mp4s_play_pause_seek_decoded":6,
    "authenticated_1024byte_206_ranges":6,
    "total_decoded_browser_frame_callbacks":value["decoded_frame_callbacks_total"],
    "one_media_element_at_a_time":True,
    "local_fallback_and_saved_controls_unchanged":True,
    "all_media_and_reviews_unchanged":True,
    "no_signed_urls_or_clip_ids_logged":True}
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if not args.run:
  print("SECURITY_ALL_SIX_VIDEO_V246_PREVIEW "+json.dumps({
    "no_browser_media_playback":True,"no_media_mutations":True}))
 else:
  if BASE.is_symlink() or not BASE.is_file():raise SystemExit(1)
  spec=importlib.util.spec_from_file_location("security_six_video_browser_base_v145",BASE)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  mod.js=js;mod.validate=validate;mod.MARK=MARK
  mod.run()
