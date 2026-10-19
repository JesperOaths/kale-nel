#!/usr/bin/env python3
"""Non-destructive all-import authenticated Chromium byte-range validation.

Shares the already deployed v136 browser/camera/static preflights, avoids
actual Save/Delete events or re-generating a live index, tests every verified
migrated file, and never logs clip names, signed URLs, tokens or video pixels.
This is NOT clearance to delete local video copies.
"""
import importlib.util
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
BASE=HERE/"smoke-c720p-legacy-auth-browser-v136.py"
MARK="C720P_MIGRATED_ALL_BROWSER_RANGES_V146_VERIFIED "
UNITS=("c720p-legacy-s9-index-bridge-guard-v1.path",
       "c720p-legacy-s9-index-bridge-guard-v1.timer")

def units():
 for name in UNITS:
  proc=subprocess.run(["systemctl","--user","is-active",name],
    capture_output=True,text=True,timeout=8,check=False)
  if proc.returncode!=0 or proc.stdout.strip()!="active":
   raise RuntimeError("regenerated_index_guard_not_active")
 return True

def script():
 return r"""(async()=>{
  const relay=window.C720PSecureRelay;
  if(!relay||typeof relay.fetch!=='function'||typeof relay.url!=='function')
    return {ok:false,reason:'authenticated_relay_unavailable'};
  const assets=[
    ['/local/frontyard-security-new/clips.html','C720P_MIGRATED_S9_LEGACY_PLAYER_V1'],
    ['/local/frontyard-security-new/index.html','c720p-migrated-index-playback-v1.js'],
    ['/local/frontyard-security-new/c720p-migrated-index-playback-v1.js','C720PSecureRelay']
  ];
  for(const [url,mark] of assets){
   const res=await fetch(url+'?v146=1',{cache:'no-store'});
   if(res.status!==200)return {ok:false,reason:'static_asset_unavailable'};
   if(!(await res.text()).includes(mark))return {ok:false,reason:'static_bridge_missing'};
  }
  const response=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
  if(response.status!==200)return {ok:false,reason:'manifest_http_unavailable'};
  const d=await response.json();
  const list=d?.files;
  if(d?.ok!==true||d.schema_version!=='c720p_s9_verified_import_v2'||
     d.not_s9_original_recordings!==true||d.not_person_assignments!==true||
     !Number.isSafeInteger(d.total_imported)||d.total_imported<6||
     d.total_imported>5000||!Array.isArray(list)||list.length!==d.total_imported)
     return {ok:false,reason:'manifest_contract_invalid'};
  const pattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
  const seen=new Set();
  for(const f of list){
    if(!f||typeof f.name!=='string'||!pattern.test(f.name)||f.name.includes('..')||
       seen.has(f.name)||!Number.isSafeInteger(f.bytes)||f.bytes<10000||
       f.bytes>943718400||typeof f.indexed!=='boolean')
       return {ok:false,reason:'unsafe_or_duplicate_manifest_name'};
    seen.add(f.name);
  }
  let signed=0,passed=0;
  for(const f of list){
    const route='/new/saved/c720p-migrated/clip/'+encodeURIComponent(f.name);
    const ticket=await relay.url(route);
    if(typeof ticket!=='string'||ticket.length<8)
      return {ok:false,reason:'signed_ticket_unavailable',passed};
    signed++;
    const mp4=await relay.fetch(route,{method:'GET',
      headers:{Range:'bytes=0-1023'},cache:'no-store'});
    const length=Number(mp4.headers.get('Content-Length')||0);
    const range=mp4.headers.get('Content-Range')||'';
    const type=(mp4.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(mp4.status!==206||length!==1024||
       range!=='bytes 0-1023/'+String(f.bytes)||type!=='video/mp4'){
      try{await mp4.body?.cancel()}catch(_){}
      return {ok:false,reason:'range_contract_failed',passed};
    }
    const bytes=await mp4.arrayBuffer();
    if(bytes.byteLength!==1024)return {ok:false,reason:'range_body_short',passed};
    passed++;
  }
  return {ok:true,authenticated_relay:true,static_assets_served:3,
   manifest_count:list.length,signed_tickets:signed,
   authenticated_ranges_206:passed,each_range_bytes:1024,
   no_video_decoded:true,originals_modified:false,manual_reviews_modified:false,
   filenames_not_returned:true,signed_urls_not_returned:true};
 })()"""

def validate(data):
 if not isinstance(data,dict):raise RuntimeError("browser_probe_missing")
 if (data.get("ok") is not True or data.get("authenticated_relay") is not True
  or data.get("static_assets_served")!=3
  or type(data.get("manifest_count")) is not int or data["manifest_count"]<6
  or data["manifest_count"]>5000
  or data.get("signed_tickets")!=data["manifest_count"]
  or data.get("authenticated_ranges_206")!=data["manifest_count"]
  or data.get("each_range_bytes")!=1024
  or data.get("no_video_decoded") is not True
  or data.get("originals_modified") is not False
  or data.get("manual_reviews_modified") is not False
  or data.get("filenames_not_returned") is not True
  or data.get("signed_urls_not_returned") is not True):
  raise RuntimeError("all_migrated_browser_ranges_not_verified_"+str(data.get("reason","metrics"))[:65])
 return {"authenticated_all_import_ranges":True,
         "migrated_manifest_count":data["manifest_count"],
         "ranges_206":data["authenticated_ranges_206"],
         "signed_tickets":data["signed_tickets"],
         "bounded_1024_bytes_each":True,
         "index_guard_active":True,
         "file_names_not_logged":True,
         "no_media_mutations":True,"reviews_modified":False,
         "local_copy_retention_required":True}

def run():
 if not BASE.is_file() or BASE.is_symlink():raise RuntimeError("original_smoke_source_missing")
 units()
 spec=importlib.util.spec_from_file_location("c720p_legacy_browser_v136",BASE)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 mod.script=script
 mod.validate_result=validate
 mod.MARK=MARK
 mod.run()
 units()

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 if args.run:run()
 else:
  units()
  print("C720P_MIGRATED_ALL_BROWSER_V146_PREFLIGHT "+json.dumps({
   "index_regeneration_guard_active":True,
   "media_modified":False,"browser_not_started":True},sort_keys=True),flush=True)
