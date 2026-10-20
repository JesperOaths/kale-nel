#!/usr/bin/env python3
"""One authenticated, rendered Chromium Security acceptance, no live mutations.

Checks served System status, stale warnings, tab visibility / fetch counts and
one actual migrated MP4 play-pause-seek-decode. Never clicks Save/Delete,
creates reviews, installs camera, or retains media. The existing HA kiosk
browser is returned to its original target by the established v145 runner.
"""
import argparse
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
BASE=HERE/"smoke-c720p-migrated-decoded-browser-v145.py"
MARK="SECURITY_SYSTEM_RENDERED_BROWSER_V240_VERIFIED "

def js():
 return r"""(async()=>{
 const relay=window.C720PSecureRelay;
 if(!relay?.fetch||!relay?.url)
  return {ok:false,reason:'authenticated_relay_unavailable'};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const live=document.getElementById('panel-live');
 const controls=document.getElementById('panel-controls');
 const nav=document.getElementById('s9v5-nav');
 if(!live||!controls||!nav)
  return {ok:false,reason:'security_nav_or_panes_missing'};
 const health=document.getElementById('security-component-health-live');
 const other=document.getElementById('security-component-health-controls');
 if(!health||!other||!health.querySelector('[role=status]'))
  return {ok:false,reason:'rendered_system_status_missing'};
 const status=health.querySelector('[role=status]');
 const begun=performance.now();
 while((status.textContent.includes('Checking')||status.textContent.length<15)
   && performance.now()-begun<11000)await wait(180);
 if(status.textContent.includes('Checking'))
  return {ok:false,reason:'health_render_not_completed'};
 const response=await relay.fetch('/new/api/security-component-health',{cache:'no-store'});
 if(response.status!==200)return {ok:false,reason:'health_api_unavailable'};
 const data=await response.json();
 if(data?.ok!==true||data.schema_version!=='security_component_health_v1'||
    !data.components||!['infrastructure','evidence','saved_timing'].every(
      x=>['current','stale','unavailable'].includes(data.components[x]?.status)))
  return {ok:false,reason:'component_health_contract_invalid'};
 const statuses=Object.values(data.components).map(x=>x.status);
 const warnNeeded=statuses.some(x=>x!=='current');
 if(warnNeeded&&!status.textContent.includes('stale or unavailable'))
  return {ok:false,reason:'stale_health_rendered_as_current'};
 const ageRows=health.textContent;
 if(!ageRows.includes('Infrastructure report')||
    !ageRows.includes('Evidence report')||
    !ageRows.includes('Saved timing report')||
    !ageRows.includes('Original integrity'))
  return {ok:false,reason:'health_receipt_age_rows_missing'};
 if(!statuses.every(x=>ageRows.includes(({current:'Current',stale:'Stale',
    unavailable:'Unavailable'})[x])))
  return {ok:false,reason:'health_status_inconsistent_with_api'};
 const renderedSystem={health_sections:3,
   stale_or_unavailable_count:statuses.filter(x=>x!=='current').length,
   warnings_reflect_unavailable:!warnNeeded||status.textContent.includes('stale or unavailable'),
   receipt_ages_rendered:ageRows.includes('old')||ageRows.includes('age unknown'),
   rendered_live:true};
 if(!renderedSystem.receipt_ages_rendered)
  return {ok:false,reason:'health_receipt_age_not_rendered'};
 const liveButton=nav.querySelector('button[data-view=live]');
 const facesButton=nav.querySelector('button[data-view=faces]');
 const controlsButton=nav.querySelector('button[data-view=camera]');
 if(!liveButton||!facesButton||!controlsButton)
  return {ok:false,reason:'essential_security_controls_missing'};
 // Instrument ONLY health fetch, on a disposable temporary HA tab. Do not
 // intercept requests or alter the response. Restore in finally.
 let healthRequests=0;
 const original=relay.fetch;
 relay.fetch=function(...args){
   if(args[0]==='/new/api/security-component-health')healthRequests++;
   return original.apply(this,args);
 };
 let hiddenRequests=999,returnVisible=false,controlsVisible=false;
 try{
  controlsButton.click();
  await wait(380);
  controlsVisible=!controls.hidden&&!!document.getElementById('security-component-health-controls');
  facesButton.click();
  await wait(600);
  if(!live.hidden||!controls.hidden)
   return {ok:false,reason:'hidden_panes_not_hidden'};
  const start=healthRequests;
  await wait(16400);
  hiddenRequests=healthRequests-start;
  liveButton.click();
  await wait(550);
  returnVisible=!live.hidden&&!!document.getElementById('security-component-health-live');
 }finally{relay.fetch=original;}
 if(!controlsVisible||!returnVisible||hiddenRequests>0)
  return {ok:false,reason:'hidden_pane_polling_not_gated'};
 const catalog=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
 if(catalog.status!==200)return {ok:false,reason:'migrated_manifest_unavailable'};
 const manifest=await catalog.json();
 if(manifest?.ok!==true||manifest.schema_version!=='c720p_s9_verified_import_v2'||
   !Array.isArray(manifest.files)||manifest.files.length!==6||
   manifest.total_imported!==6)
  return {ok:false,reason:'migrated_manifest_mismatch'};
 const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
 const rec=manifest.files.find(x=>x&&valid.test(x.name)&&!x.name.includes('..')&&
  Number.isSafeInteger(x.bytes)&&x.bytes>=10000&&x.bytes<=943718400);
 if(!rec)return {ok:false,reason:'migrated_sample_unavailable'};
 const route='/new/saved/c720p-migrated/clip/'+encodeURIComponent(rec.name);
 const part=await relay.fetch(route,{
   method:'GET',headers:{Range:'bytes=0-1023'},cache:'no-store'});
 if(part.status!==206)
  return {ok:false,reason:'streamed_range_206_unavailable'};
 const chunk=await part.arrayBuffer();
 if(chunk.byteLength!==1024)
  return {ok:false,reason:'streamed_range_not_bounded'};
 const signed=await relay.url(route);
 if(typeof signed!=='string'||signed.length<10)
  return {ok:false,reason:'signed_media_url_missing'};
 const video=document.createElement('video');
 video.muted=true;video.playsInline=true;video.preload='metadata';
 video.controls=true;video.style.cssText='position:fixed;left:0;top:0;width:380px;height:214px;z-index:10000;background:#000';
 document.body.append(video);
 let frames=0;
 try{
  if(typeof video.requestVideoFrameCallback!=='function')
   return {ok:false,reason:'video_frame_callback_unsupported'};
  const frame=()=>{frames++;if(video.isConnected)video.requestVideoFrameCallback(frame);};
  video.requestVideoFrameCallback(frame);
  video.src=signed;
  const timeout=(p,ms)=>Promise.race([p,new Promise((_,reject)=>
    setTimeout(()=>reject(Error('bounded_video_timeout')),ms))]);
  await timeout(video.play(),5500);
  await wait(1350);video.pause();
  const first=video.currentTime;
  if(video.videoWidth<120||video.videoHeight<90||frames<2||!video.paused||
     !Number.isFinite(video.duration)||video.duration<2.0)
   return {ok:false,reason:'play_pause_decode_not_verified'};
  const target=Math.min(video.duration-0.6,Math.max(first+0.45,2.1));
  let sought=false;
  const seekDone=new Promise(resolve=>{
   const cb=()=>{sought=true;resolve();};
   video.addEventListener('seeked',cb,{once:true});
  });
  video.currentTime=target;
  await timeout(seekDone,6500);
  const afterSeek=video.currentTime;
  await timeout(video.play(),4500);
  await wait(450);video.pause();
  return {ok:frames>=3&&sought&&afterSeek>=target-0.35&&video.paused,
   reason:frames>=3&&sought&&afterSeek>=target-0.35&&video.paused?null:'seek_or_second_decode_failed',
   ...renderedSystem,
   controls_panel_visible:true,hidden_health_requests: hiddenRequests,
   live_panel_returned:true,
   playback_stream_http:part.status,bounded_range_bytes:chunk.byteLength,
   rendered_video_frames:frames,
   video_width:video.videoWidth,video_height:video.videoHeight,
   play_pause_seek_replay:true,
   six_migrated_manifest_entries:manifest.files.length,
   all_six_decoded_claimed:false,
   security_save_delete_invoked:false,
   person_filing_invoked:false,
   private_clip_names_returned:false,signed_urls_returned:false,
   media_modified:false};
 }catch(_){return {ok:false,reason:'video_playback_exception'};}
 finally{video.pause();video.removeAttribute('src');video.load();video.remove();}
 })()"""

def validate(value):
 if not isinstance(value,dict) or value.get("ok") is not True:
  approved={"authenticated_relay_unavailable","security_nav_or_panes_missing",
   "rendered_system_status_missing","health_render_not_completed",
   "health_api_unavailable","component_health_contract_invalid",
   "stale_health_rendered_as_current","health_receipt_age_rows_missing",
   "health_status_inconsistent_with_api","health_receipt_age_not_rendered",
   "essential_security_controls_missing","hidden_panes_not_hidden",
   "hidden_pane_polling_not_gated","migrated_manifest_unavailable",
   "migrated_manifest_mismatch","migrated_sample_unavailable",
   "streamed_range_206_unavailable","streamed_range_not_bounded",
   "signed_media_url_missing","video_frame_callback_unsupported",
   "play_pause_decode_not_verified","seek_or_second_decode_failed",
   "video_playback_exception"}
  reason=str((value or {}).get("reason","unknown"))
  raise RuntimeError("security_browser_v240_"+(reason if reason in approved else "unknown"))
 expected={
  "health_sections":3,"rendered_live":True,
  "warnings_reflect_unavailable":True,"receipt_ages_rendered":True,
  "controls_panel_visible":True,"hidden_health_requests":0,
  "live_panel_returned":True,"playback_stream_http":206,
  "bounded_range_bytes":1024,"play_pause_seek_replay":True,
  "six_migrated_manifest_entries":6,"all_six_decoded_claimed":False,
  "security_save_delete_invoked":False,"person_filing_invoked":False,
  "private_clip_names_returned":False,"signed_urls_returned":False,
  "media_modified":False}
 if any(value.get(k)!=v for k,v in expected.items()) or (
   not isinstance(value.get("rendered_video_frames"),int) or
   value["rendered_video_frames"]<3 or
   not isinstance(value.get("video_width"),int) or value["video_width"]<120 or
   not isinstance(value.get("video_height"),int) or value["video_height"]<90):
  raise RuntimeError("security_browser_v240_metrics")
 return {"actual_system_status_panels_verified":2,
   "rendered_health_sections":3,
   "component_warnings_consistent":True,
   "receipts_age_rendered":True,
   "hidden_pane_health_fetch_count":0,
   "one_authenticated_original_or_migrated_video_rendered":True,
   "one_video_play_pause_seek_verified":True,
   "decoded_frame_callbacks":value["rendered_video_frames"],
   "six_manifest_entries_seen_not_six_decoded":True,
   "authorized_206_range_bounded":True,
   "all_migrations_media_or_reviews_unchanged":True,
   "client_cache_refresh_across_release_not_tested":True,
   "video_file_or_url_disclosed":False}

if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--run",action="store_true")
 args=ap.parse_args()
 if not args.run:
  print("SECURITY_SYSTEM_BROWSER_V240_PREVIEW "+json.dumps({
   "actual_browser_not_started":True,"source_only":True,
   "no_media_or_review_changes":True},sort_keys=True))
 else:
  if BASE.is_symlink() or not BASE.is_file():
   raise SystemExit("SECURITY_BROWSER_V240_BASE_UNAVAILABLE")
  spec=importlib.util.spec_from_file_location("security_v240_base",BASE)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  mod.js=js;mod.validate=validate;mod.MARK=MARK
  mod.run()
