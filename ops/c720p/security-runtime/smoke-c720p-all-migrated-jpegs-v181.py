#!/usr/bin/env python3
"""Verify all six S9+ migrated C720P JPEGs in both private relays and HA Chromium.

Does not install, restart, delete, Save, reassign, scan MP4 bytes, or change
Home Assistant. Names, checksums, actual image pixels, signed URLs and user
identities are never written to output. ONLY run after v177 relay deployment.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

HERE=Path(__file__).resolve().parent
PROOF_LIB=HERE/"s9_c720p_snapshots_v163.py"
BROWSER_LIB=HERE/"smoke-c720p-legacy-auth-browser-v136.py"
EVENTS=Path("/opt/homeassistant/config/www/frontyard-security-new/events.json")
MARK="C720P_S9_ALL_SNAPSHOTS_V181_VERIFIED "
NAME_JPG=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg\Z")
NAME_MP4=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
MAX_JPEG=5_000_000
EXPECTED=6
EXPECTED_BYTES=1_956_743

def load(name,path):
 if path.is_symlink() or not path.is_file() or path.stat().st_size>100000:
  raise RuntimeError("trusted_test_library_missing")
 spec=importlib.util.spec_from_file_location(name,path)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod

def evidence():
 mod=load("c720p_all_snapshots_v181",PROOF_LIB)
 rows=mod.read_proof()
 if (len(rows)!=EXPECTED or sum(item["bytes"] for item in rows.values())!=EXPECTED_BYTES):
  raise RuntimeError("private_snapshot_proof_count_or_bytes_changed")
 if EVENTS.is_symlink() or not EVENTS.is_file() or not 2<EVENTS.stat().st_size<3000000:
  raise RuntimeError("legacy_events_unavailable")
 data=json.loads(EVENTS.read_bytes())
 if isinstance(data,dict):
  data=next((data[k] for k in ("events","items","clips")
     if isinstance(data.get(k),list)),None)
 if not isinstance(data,list) or len(data)>10000:
  raise RuntimeError("legacy_events_schema_invalid")
 names=set();clips=set()
 for entry in data:
  if not isinstance(entry,dict) or not isinstance(entry.get("clip"),str):
   continue
  clip=entry["clip"];snap=entry.get("snapshot")
  if not (isinstance(snap,str) and len(Path(clip).parts)==2
          and Path(clip).parts[0]=="clips" and NAME_MP4.fullmatch(Path(clip).name)
          and len(Path(snap).parts)==2 and Path(snap).parts[0]=="snaps"
          and NAME_JPG.fullmatch(Path(snap).name)
          and ".." not in clip and ".." not in snap):
   raise RuntimeError("unsafe_legacy_event_media_path")
  jpg=Path(snap).name
  if jpg in names or clip in clips:
   raise RuntimeError("duplicate_legacy_event_media_reference")
  names.add(jpg);clips.add(clip)
 if names!=set(rows):
  raise RuntimeError("imported_jpeg_catalog_parity_missing")
 return rows

def fetch(port,name,method="GET",headers=None):
 url="http://127.0.0.1:"+str(port)+"/new/saved/c720p-migrated/snap/"+urllib.parse.quote(name,safe="")
 req=urllib.request.Request(url,method=method,headers=headers or {})
 try:return urllib.request.urlopen(req,timeout=24)
 except urllib.error.HTTPError:
  raise
 except Exception:
  raise RuntimeError("snapshot_loopback_unavailable") from None

def host_check(rows):
 verified=0
 for name in sorted(rows):
  item=rows[name]
  if not NAME_JPG.fullmatch(name) or ".." in name or not 1000<=item["bytes"]<=MAX_JPEG:
   raise RuntimeError("unsafe_snapshot_manifest_entry")
  expected_sha=item["sha256"]
  last=None
  for port in (8795,8794):
   with fetch(port,name) as r:
    body=r.read(item["bytes"]+1)
    if (r.status!=200 or r.headers.get_content_type()!="image/jpeg"
        or r.headers.get("Content-Length")!=str(item["bytes"])
        or "no-store" not in r.headers.get("Cache-Control","")
        or len(body)!=item["bytes"]
        or not body.startswith(b"\xff\xd8\xff")
        or not body.endswith(b"\xff\xd9")
        or hashlib.sha256(body).hexdigest()!=expected_sha):
     raise RuntimeError("snapshot_sha_or_http_contract_mismatch")
   signature=hashlib.sha256(body).digest()
   if last is not None and last!=signature:
    raise RuntimeError("snapshot_proxy_body_mismatch")
   last=signature
   with fetch(port,name,method="HEAD") as head:
    if (head.status!=200 or head.headers.get("Content-Length")!=str(item["bytes"])
        or head.headers.get_content_type()!="image/jpeg"
        or head.read(1)!=b""):
     raise RuntimeError("snapshot_head_contract_changed")
   try:
    with fetch(port,name,headers={"Range":"bytes=0-1"}) as bad:
     bad.read(1)
    raise RuntimeError("snapshot_range_was_unexpectedly_accepted")
   except urllib.error.HTTPError as error:
    if error.code!=400:raise RuntimeError("snapshot_range_status_mismatch") from None
  verified+=1
 return {"sha256_matched_on_both_private_ports":verified,
  "head_and_range_negative_tests_each":2*verified,
  "provenance_catalog_parity":True,
  "media_deleted":False,"review_decisions_changed":False}

def browser_script():
 return r"""(async()=>{
   const relay=window.C720PSecureRelay;
   if(typeof relay?.fetch!=='function'||typeof relay?.url!=='function')
    return {ok:false,reason:'auth_relay_missing'};
   const catalogResponse=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
   if(catalogResponse.status!==200)return {ok:false,reason:'mp4_catalog_missing'};
   const catalog=await catalogResponse.json();
   if(catalog?.ok!==true||catalog.schema_version!=='c720p_s9_verified_import_v2'||
      catalog.total_imported!==6||!Array.isArray(catalog.files)||
      catalog.files.length!==6)return {ok:false,reason:'mp4_catalog_contract'};
   const eventsResponse=await fetch('/local/frontyard-security-new/events.json?v181=1',{cache:'no-store'});
   if(eventsResponse.status!==200)return {ok:false,reason:'legacy_events_unavailable'};
   let events=await eventsResponse.json();
   if(!Array.isArray(events))events=events?.events||events?.items||events?.clips;
   if(!Array.isArray(events)||events.length>10000)return {ok:false,reason:'legacy_event_format'};
   const mp4=new Set(catalog.files.map(f=>f.name));
   if(mp4.size!==6)return {ok:false,reason:'duplicate_import'};
   const safeMp4=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
   const safeJpeg=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.jpg$/;
   const jpg=new Set();let count=0;
   for(const event of events){
    if(!event||typeof event.clip!=='string'||!event.clip.startsWith('clips/'))
     continue;
    const parts=event.clip.split('/');
    if(parts.length!==2||!safeMp4.test(parts[1])||parts[1].includes('..'))
     return {ok:false,reason:'unsafe_catalog_clip'};
    if(!mp4.has(parts[1]))continue;
    const path=event.snapshot;
    if(typeof path!=='string'||!path.startsWith('snaps/'))
     return {ok:false,reason:'missing_snapshot_reference'};
    const bits=path.split('/');
    if(bits.length!==2||!safeJpeg.test(bits[1])||bits[1].includes('..')||jpg.has(bits[1]))
     return {ok:false,reason:'unsafe_or_duplicate_snapshot'};
    jpg.add(bits[1]);count++;
   }
   if(count!==6)return {ok:false,reason:'snapshot_catalog_mismatch'};
   let ok=0,decoded=0,signed=0,totalBytes=0;
   for(const name of jpg){
    const route='/new/saved/c720p-migrated/snap/'+encodeURIComponent(name);
    const url=await relay.url(route);
    if(typeof url!=='string'||url.length<8)return {ok:false,reason:'signed_jpeg_unavailable',ok};
    signed++;
    const res=await relay.fetch(route,{method:'GET',cache:'no-store'});
    if(res.status!==200||res.headers.get('Content-Type')?.split(';')[0].trim()!=='image/jpeg')
     return {ok:false,reason:'jpeg_http_or_type',ok};
    const length=Number(res.headers.get('Content-Length'));
    if(!Number.isSafeInteger(length)||length<1000||length>5000000)
     return {ok:false,reason:'jpeg_length_untrusted',ok};
    const buffer=await res.arrayBuffer();
    if(buffer.byteLength!==length)return {ok:false,reason:'jpeg_bytes_invalid',ok};
    const bytes=new Uint8Array(buffer);
    if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
       bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)
     return {ok:false,reason:'jpeg_markers_invalid',ok};
    try{
      const image=await createImageBitmap(new Blob([buffer],{type:'image/jpeg'}));
      if(image.width<32||image.height<32){image.close();return {ok:false,reason:'jpeg_decode_dimensions',ok};}
      image.close();decoded++;
    }catch(e){return {ok:false,reason:'jpeg_browser_decoder',ok};}
    totalBytes+=length;ok++;
   }
   return {ok:true,authenticated_snapshot_gets:ok,signed_urls:signed,
      browser_decoded_jpegs:decoded,browser_snapshot_total_bytes:totalBytes,
      private_filenames_not_returned:true,signed_urls_not_returned:true,
      no_media_changes:true,no_review_changes:true};
 })()"""

def browser_validate(data):
 if not isinstance(data,dict) or data.get("ok") is not True:
  raise RuntimeError("browser_jpeg_not_verified_"+str((data or {}).get("reason","invalid"))[:45])
 if (data.get("authenticated_snapshot_gets")!=EXPECTED or
     data.get("signed_urls")!=EXPECTED or
     data.get("browser_decoded_jpegs")!=EXPECTED or
     data.get("browser_snapshot_total_bytes")!=EXPECTED_BYTES or
     data.get("private_filenames_not_returned") is not True or
     data.get("signed_urls_not_returned") is not True or
     data.get("no_media_changes") is not True or
     data.get("no_review_changes") is not True):
  raise RuntimeError("browser_jpeg_aggregate_contract_invalid")
 return {"authenticated_all_six_jpegs":True,
         "browser_decoded_jpegs":EXPECTED,
         "verified_snapshot_bytes":EXPECTED_BYTES,
         "signed_urls_not_exposed":True,"names_not_exposed":True,
         "no_media_changes":True,"no_review_changes":True}

def run():
 rows=evidence()
 mod=load("c720p_jpeg_v181_browser",BROWSER_LIB)
 before=mod.capture()
 summary=host_check(rows)
 mod.script=browser_script
 mod.validate_result=browser_validate
 mod.MARK=MARK
 mod.run()
 after=mod.capture()
 if not after["continuous_4k_ready"] or after["continuous_4k_dropped_output_frames"]!=0:
  raise RuntimeError("s9_4k_state_not_preserved")
 print("C720P_S9_ALL_JPEG_HOST_V181_VERIFIED "+json.dumps({
   **summary,
   "private_jpeg_proof_count":len(rows),
   "temperature_after_c":after["temperature_c"],
   "camera_4k_ready_after":True,"camera_dropped_frames_after":0,
   "c720p_mp4s_and_jpegs_still_required":True},sort_keys=True),flush=True)

def safe_reason(error):
 s=str(error)
 return next((x for x in (
  "private_snapshot_proof_count_or_bytes_changed",
  "legacy_events_unavailable","legacy_events_schema_invalid",
  "unsafe_legacy_event_media_path","duplicate_legacy_event_media_reference",
  "imported_jpeg_catalog_parity_missing","unsafe_snapshot_manifest_entry",
  "snapshot_loopback_unavailable","snapshot_sha_or_http_contract_mismatch",
  "snapshot_proxy_body_mismatch","snapshot_head_contract_changed",
  "snapshot_range_was_unexpectedly_accepted","snapshot_range_status_mismatch",
  "s9_4k_state_not_preserved","trusted_test_library_missing")
  if s.startswith(x)),"other_no_private_detail")

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 if not args.run:
  rows=evidence()
  print("C720P_S9_ALL_JPEG_V181_PREFLIGHT "+json.dumps({
    "verified_snapshot_manifest_entries":len(rows),
    "expected_sha_provenance":True,
    "authenticated_routes_not_queried":True,
    "browser_not_started":True,
    "no_media_changes":True},sort_keys=True),flush=True)
 else:
  try:run()
  except Exception as error:
   print("C720P_S9_ALL_JPEG_V181_NOT_VERIFIED "+json.dumps({
    "reason":safe_reason(error),
    "no_media_changes":True,"no_review_changes":True,
    "local_originals_retained":True},sort_keys=True),flush=True)
   raise SystemExit(1)
