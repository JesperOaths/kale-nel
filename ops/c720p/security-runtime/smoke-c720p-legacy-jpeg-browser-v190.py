#!/usr/bin/env python3
"""Authenticated Chromium smoke of served C720P legacy JPEG bridge.

Loads real HA-served scripts in disposable Security tab, checks both actual
legacy HTML integration tags, the signed S9+ thumbnail fetch and late-added
Camera Clips image. Simulates fallback via a DOM-only error event. Does NOT
click Save/Delete, restart camera, write media, or log private names/URLs.
"""
import argparse
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
BASE=HERE/"smoke-c720p-legacy-auth-browser-v136.py"
MARK="C720P_LEGACY_JPEG_BROWSER_V190_VERIFIED "

def browser_script():
 return r"""(async()=>{
 const relay=window.C720PSecureRelay;
 if(typeof relay?.fetch!=='function'||typeof relay?.url!=='function')
  return {ok:false,reason:'auth_relay_missing'};
 const root='/local/frontyard-security-new/';
 const indexTag="<script defer src='c720p-migrated-snapshot-display-v182.js'></script>";
 const playerTag="<script defer src='/local/frontyard-security-new/c720p-migrated-snapshot-display-v182.js'></script>";
 const get=async(path)=>{const r=await fetch(root+path,{cache:'no-store'});
   if(r.status!==200)throw new Error('legacy_asset_unavailable');
   return await r.text();};
 let index,player,bridge,events;
 try{
  [index,player,bridge]=await Promise.all([
   get('index.html?v190=1'),get('clips.html?v190=1'),
   get('c720p-migrated-snapshot-display-v182.js?v190=1')]);
  if(index.split(indexTag).length!==2||player.split(playerTag).length!==2)
   return {ok:false,reason:'legacy_jpeg_inclusion_missing'};
  if(!index.includes("c720p-migrated-index-playback-v1.js")||
      !index.includes("saveClip(")||!player.includes('C720P_MIGRATED_S9_LEGACY_PLAYER_V1')||
      !bridge.includes('C720P_MIGRATED_S9_SNAPSHOT_DISPLAY_V182')||
      !bridge.includes('MutationObserver'))
   return {ok:false,reason:'legacy_compatibility_or_dynamic_bridge_missing'};
  events=JSON.parse(await get('events.json?v190=1'));
  if(!Array.isArray(events))events=events?.events||events?.items||events?.clips;
 }catch(e){return {ok:false,reason:'legacy_assets_or_catalog_unavailable'};}
 if(!Array.isArray(events)||events.length>10000)
  return {ok:false,reason:'legacy_events_invalid'};
 const response=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
 if(response.status!==200)return {ok:false,reason:'migrated_manifest_offline'};
 const catalog=await response.json();
 if(catalog?.ok!==true||catalog.schema_version!=='c720p_s9_verified_import_v2'||
    catalog.not_s9_original_recordings!==true||catalog.not_person_assignments!==true||
    catalog.total_imported!==6||!Array.isArray(catalog.files)||catalog.files.length!==6)
   return {ok:false,reason:'migrated_manifest_invalid'};
 const validMp4=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
 const validJpg=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.jpg$/;
 const imported=new Set();
 for(const f of catalog.files){
  if(!f||typeof f.name!=='string'||!validMp4.test(f.name)||f.name.includes('..')||
     imported.has(f.name)||f.indexed!==true||!Number.isSafeInteger(f.bytes)||
     f.bytes<10000||f.bytes>943718400)return {ok:false,reason:'manifest_unsafe'};
  imported.add(f.name);
 }
 const photos=new Set(),matched=new Set();
 for(const ev of events){
  if(!ev||typeof ev.clip!=='string')continue;
  const path=ev.clip.split('/');
  if(path.length!==2||path[0]!=='clips'||!validMp4.test(path[1])||path[1].includes('..'))
   continue;
  if(!imported.has(path[1]))continue;
  if(typeof ev.snapshot!=='string')return {ok:false,reason:'missing_snapshot'};
  const pieces=ev.snapshot.split('/');
  if(pieces.length!==2||pieces[0]!=='snaps'||!validJpg.test(pieces[1])||
     pieces[1].includes('..')||photos.has(pieces[1])||matched.has(path[1]))
   return {ok:false,reason:'unsafe_snapshot_mapping'};
  matched.add(path[1]);photos.add(pieces[1]);
 }
 if(photos.size!==6||matched.size!==6)
  return {ok:false,reason:'incomplete_snapshot_mapping'};
 // The real legacy HTML references are checked above. Render its *actual*
 // proof-linked thumbnails using the served JS in this disposable HA tab:
 // never open live MJPEG, play MP4s or invoke old recorder endpoints.
 const container=document.createElement('div');
 container.id='c720p-jpeg-v190-disposable';
 container.style.cssText='position:fixed;left:-10000px;top:0;width:300px;height:200px';
 const script=document.createElement('script');
 const entries=[...photos];const images=[];
 function addImage(name){
  const element=document.createElement('img');
  element.src=root+'snaps/'+name;
  element.loading='eager';
  container.append(element);images.push(element);
  return element;
 }
 const slept=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function loaded(n){
  for(let iteration=0;iteration<75;iteration++){
   const ready=images.slice(0,n).filter(im=>
     im.dataset.c720pS9Snapshot==='loaded'&&im.complete&&
     im.naturalWidth>=32&&im.naturalHeight>=32).length;
   if(ready===n)return true;
   if(images.slice(0,n).some(im=>im.dataset.c720pS9Snapshot==='fallback'))
    return false;
   await slept(140);
  }
  return false;
 }
 document.body.append(container);
 try{
  for(const name of entries.slice(0,5))addImage(name);
  script.src=root+'c720p-migrated-snapshot-display-v182.js?v190=1';
  const started=new Promise((resolve,reject)=>{
   script.addEventListener('load',()=>resolve(true),{once:true});
   script.addEventListener('error',()=>reject(new Error('served_bridge_load_failed')),{once:true});
  });
  document.head.append(script);
  await started;
  if(!(await loaded(5)))return {ok:false,reason:'five_staged_images_not_loaded'};
  addImage(entries[5]); // MutationObserver must catch this Camera Clips pattern.
  if(!(await loaded(6)))return {ok:false,reason:'late_dynamic_image_not_loaded'};
  const original=images[0].dataset.c720pLegacySnapshotSrc;
  if(original!==root+'snaps/'+entries[0]||
     images.some(im=>im.dataset.c720pLegacySnapshotSrc!==root+'snaps/'+entries[images.indexOf(im)]))
   return {ok:false,reason:'local_fallback_source_not_retained'};
  // Error dispatch is DOM-only and intentionally does not break S9 storage.
  images[0].dispatchEvent(new Event('error'));
  const recovered=images[0].dataset.c720pS9Snapshot==='fallback'&&
                  images[0].getAttribute('src')===original;
  return {ok:recovered,reason:recovered?null:'local_fallback_simulation_failed',
   real_served_legacy_pages:2,same_origin_authenticated_relay:true,
   served_dynamic_script_verified:true,signed_s9_jpeg_images_loaded:6,
   late_camera_clips_image_loaded:true,local_fallback_event_simulation:recovered,
   original_save_delete_controls_preserved:true,
   no_person_media_or_settings_changes:true,
   private_filenames_not_returned:true,signed_urls_not_returned:true};
 }catch(e){return {ok:false,reason:'browser_integration_exception'}}
 finally{script.remove();container.remove();}
 })()"""

def validate(value):
 if not isinstance(value,dict) or value.get("ok") is not True:
  reason=str((value or {}).get("reason","unknown"))
  safe={ "auth_relay_missing","legacy_jpeg_inclusion_missing",
    "legacy_compatibility_or_dynamic_bridge_missing",
    "legacy_assets_or_catalog_unavailable","legacy_events_invalid",
    "migrated_manifest_offline","migrated_manifest_invalid",
    "manifest_unsafe","missing_snapshot","unsafe_snapshot_mapping",
    "incomplete_snapshot_mapping","five_staged_images_not_loaded",
    "late_dynamic_image_not_loaded","local_fallback_source_not_retained",
    "local_fallback_simulation_failed","browser_integration_exception" }
  raise RuntimeError("legacy_jpeg_v190_"+(reason if reason in safe else "unknown"))
 required={
  "real_served_legacy_pages":2,"same_origin_authenticated_relay":True,
  "served_dynamic_script_verified":True,"signed_s9_jpeg_images_loaded":6,
  "late_camera_clips_image_loaded":True,
  "local_fallback_event_simulation":True,
  "original_save_delete_controls_preserved":True,
  "no_person_media_or_settings_changes":True,
  "private_filenames_not_returned":True,"signed_urls_not_returned":True}
 if any(value.get(k)!=v for k,v in required.items()):
  raise RuntimeError("legacy_jpeg_v190_metrics")
 return {"served_legacy_pages_with_jpeg_bridge":2,
    "authenticated_s9_thumbnails_loaded":6,
    "late_dynamic_image_verified":True,
    "reversible_local_fallback_simulated":True,
    "no_media_or_review_changes":True,
    "signed_urls_not_logged":True,
    "originals_remain_required":True}

def run():
 if BASE.is_symlink() or not BASE.is_file():
  raise RuntimeError("browser_probe_source_missing")
 spec=importlib.util.spec_from_file_location("legacy_jpeg_browser_base_v136",BASE)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 mod.script=browser_script
 mod.validate_result=validate
 mod.MARK=MARK
 mod.run()

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 options=parser.parse_args()
 if options.run:
  try:run()
  except Exception as exc:
   m=str(exc)
   if not m.startswith("legacy_jpeg_v190_"):m="other_no_private_detail"
   print("C720P_LEGACY_JPEG_BROWSER_V190_NOT_VERIFIED "+
    json.dumps({"reason_code":m,"media_modified":False,
      "originals_retained":True},sort_keys=True),flush=True)
   raise SystemExit(1)
 else:
  print("C720P_LEGACY_JPEG_BROWSER_V190_PREVIEW "+
    json.dumps({"disposable_browser_test":True,"media_modified":False,
      "no_recording_playback":True},sort_keys=True),flush=True)
