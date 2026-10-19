#!/usr/bin/env python3
"""Non-destructive all-import authenticated Chromium byte-range validation.

Shares the already deployed v136 browser/camera/static preflights, avoids
actual Save/Delete events or re-generating a live index, tests every verified
migrated file, and never logs clip names, signed URLs, tokens or video pixels.
This is NOT clearance to delete local video copies.
"""
import importlib.util
import hashlib
import json
import urllib.request
import urllib.parse
import urllib.error
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
  let signed=0,passed=0,contentRangeExposed=0;
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
    const failure=mp4.status!==206?'range_non206':
      length!==1024?'range_bad_length':
      range&&range!=='bytes 0-1023/'+String(f.bytes)?'range_manifest_total_mismatch':
      type!=='video/mp4'?'range_bad_mime':null;
    if(failure){
      try{await mp4.body?.cancel()}catch(_){}
      return {ok:false,reason:failure,passed};
    }
    if(range)contentRangeExposed++;
    const bytes=await mp4.arrayBuffer();
    if(bytes.byteLength!==1024)return {ok:false,reason:'range_body_short',passed};
    passed++;
  }
  return {ok:true,authenticated_relay:true,static_assets_served:3,
   manifest_count:list.length,signed_tickets:signed,
   authenticated_ranges_206:passed,each_range_bytes:1024,
   browser_content_range_exposed_count:contentRangeExposed,
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
  or type(data.get("browser_content_range_exposed_count")) is not int
  or not 0<=data["browser_content_range_exposed_count"]<=data["manifest_count"]
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
         "browser_content_range_exposed":data["browser_content_range_exposed_count"],
         "signed_tickets":data["signed_tickets"],
         "bounded_1024_bytes_each":True,
         "index_guard_active":True,
         "file_names_not_logged":True,
         "no_media_mutations":True,"reviews_modified":False,
         "local_copy_retention_required":True}

HOST_MARK="C720P_MIGRATED_ALL_HOST_RANGES_V148_VERIFIED "
HOST_SCHEMA="c720p_s9_verified_import_v2"
HOST_RANGE={"Range":"bytes=0-1023","Cache-Control":"no-store"}
HOST_MAX=300000

def host_fetch(port,route,limit,headers=None):
 req=urllib.request.Request("http://127.0.0.1:"+str(port)+route,
                            headers=headers or {})
 try:
  response=urllib.request.urlopen(req,timeout=18)
 except Exception as error:
  raise RuntimeError("host_media_unavailable") from None
 with response:
  status=response.status
  meta=response.headers
  if status==206 and meta.get("Content-Length")!="1024":
   raise RuntimeError("host_range_length_mismatch")
  raw=response.read(limit+1)
 if len(raw)>limit:raise RuntimeError("host_unbounded_media_response")
 return status,meta,raw

def host_manifest(port):
 status,h,b=host_fetch(port,"/new/api/c720p-migrated-clips",HOST_MAX)
 if status!=200 or h.get_content_type()!="application/json":
  raise RuntimeError("host_manifest_unavailable")
 try:d=json.loads(b)
 except Exception:raise RuntimeError("host_manifest_invalid") from None
 if (d.get("ok") is not True or d.get("schema_version")!=HOST_SCHEMA
  or d.get("not_s9_original_recordings") is not True
  or d.get("not_person_assignments") is not True
  or type(d.get("total_imported")) is not int
  or not 6<=d["total_imported"]<=5000
  or not isinstance(d.get("files"),list)
  or len(d["files"])!=d["total_imported"]):
  raise RuntimeError("host_manifest_invalid")
 import re
 pattern=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
 records={}
 for rec in d["files"]:
  if (not isinstance(rec,dict) or not isinstance(rec.get("name"),str)
    or not pattern.fullmatch(rec["name"]) or ".." in rec["name"]
    or rec["name"] in records or type(rec.get("bytes")) is not int
    or not 10000<=rec["bytes"]<=900*1024**2
    or type(rec.get("indexed")) is not bool):
   raise RuntimeError("host_manifest_invalid")
  records[rec["name"]]=rec["bytes"]
 return records

def host_range_all():
 # Two separate existing loopback services. The 8794 service retains its
 # deployed authentication; this diagnostic adds no user routes or secrets.
 front=host_manifest(8794)
 upstream=host_manifest(8795)
 if front!=upstream:raise RuntimeError("host_manifest_front_upstream_mismatch")
 for name,size in sorted(front.items()):
  route="/new/saved/c720p-migrated/clip/"+urllib.parse.quote(name,safe="")
  expected="bytes 0-1023/"+str(size)
  signatures=[]
  for port in (8795,8794):
   status,headers,body=host_fetch(port,route,1024,HOST_RANGE)
   if (status!=206 or headers.get("Content-Length")!="1024"
     or headers.get("Content-Range")!=expected
     or headers.get_content_type()!="video/mp4"
     or len(body)!=1024):
    raise RuntimeError("host_range_header_or_length_mismatch")
   signatures.append(hashlib.sha256(body).digest())
  if signatures[0]!=signatures[1]:
   raise RuntimeError("host_range_bytes_disagree")
 return {"all_host_headers_verified":True,
         "verified_count":len(front),
         "upstream_front_ranges_sha_equal":True,
         "each_range_bytes":1024,
         "no_media_modified":True,"no_manual_reviews_modified":True,
         "local_c720p_originals_still_required":True}

def run():
 if not BASE.is_file() or BASE.is_symlink():raise RuntimeError("original_smoke_source_missing")
 units()
 spec=importlib.util.spec_from_file_location("c720p_legacy_browser_v136",BASE)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 mod.script=script
 mod.validate_result=validate
 mod.MARK=MARK
 pre=mod.capture()
 host_summary=host_range_all()
 mod.run()
 post=mod.capture()
 units()
 if not pre["continuous_4k_ready"] or not post["continuous_4k_ready"]:
  raise RuntimeError("s9_capture_unhealthy_busy_or_hot")
 print(HOST_MARK+json.dumps(host_summary,sort_keys=True),flush=True)

def safe_failure_reason(error):
 # Produce only a bounded, authored enum; exceptions may contain private
 # browser URLs or file names and must never be dumped to management logs.
 message=str(error)
 candidates=(
  "all_migrated_browser_ranges_not_verified_authenticated_relay_unavailable",
  "all_migrated_browser_ranges_not_verified_static_asset_unavailable",
  "all_migrated_browser_ranges_not_verified_static_bridge_missing",
  "all_migrated_browser_ranges_not_verified_manifest_http_unavailable",
  "all_migrated_browser_ranges_not_verified_manifest_contract_invalid",
  "all_migrated_browser_ranges_not_verified_unsafe_or_duplicate_manifest_name",
  "all_migrated_browser_ranges_not_verified_signed_ticket_unavailable",
  "all_migrated_browser_ranges_not_verified_range_contract_failed",
  "all_migrated_browser_ranges_not_verified_range_non206",
  "all_migrated_browser_ranges_not_verified_range_bad_length",
  "all_migrated_browser_ranges_not_verified_range_manifest_total_mismatch",
  "all_migrated_browser_ranges_not_verified_range_bad_mime",
  "all_migrated_browser_ranges_not_verified_range_body_short",
  "all_migrated_browser_ranges_not_verified_metrics",
  "host_media_unavailable",
  "host_range_length_mismatch",
  "host_unbounded_media_response",
  "host_manifest_unavailable",
  "host_manifest_invalid",
  "host_manifest_front_upstream_mismatch",
  "host_range_header_or_length_mismatch",
  "host_range_bytes_disagree",
  "regenerated_index_guard_not_active",
  "missing_chromium_debugger_helper",
  "authenticated_browser_security_page_not_ready",
  "isolated_chromium_tab_not_available",
  "legacy_static_file_untrusted",
  "legacy_auth_bridge_not_installed",
  "legacy_files_drifted_during_browser_probe",
  "s9_capture_unhealthy_busy_or_hot",
 )
 for code in candidates:
  if message.startswith(code):return code
 return "other_no_private_detail"

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 try:
  if args.run:run()
  else:
   units()
   print("C720P_MIGRATED_ALL_BROWSER_V146_PREFLIGHT "+json.dumps({
    "index_regeneration_guard_active":True,
    "media_modified":False,"browser_not_started":True},sort_keys=True),flush=True)
 except Exception as error:
  print("C720P_MIGRATED_ALL_BROWSER_V146_FAILURE "+json.dumps({
   "reason_code":safe_failure_reason(error),
   "exception_class":type(error).__name__,
   "no_media_modified":True,
   "no_manual_reviews_modified":True
  },sort_keys=True),flush=True)
  raise SystemExit(1)
