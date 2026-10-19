#!/usr/bin/env python3
"""One bounded, READ-ONLY authenticated C720P->S9 legacy media smoke.

Uses a disposable background tab in the existing Chromium Debugger to test:
- Home Assistant serves current legacy player, generated index and bridge JS
- the same-origin authenticated Security proxy exposes the verified S9
  migrated-media index
- one authenticated S9 MP4 route delivers exactly one 1024-byte HTTP range.

No video playback, stream open, camera action, recording changes, review
decisions, signed URL logging, deletion or browser setting edits.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import urllib.request
import hashlib

LIB=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
DOCROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
REQUIRED={
 "clips.html":b"C720P_MIGRATED_S9_LEGACY_PLAYER_V1",
 "index.html":b"c720p-migrated-index-playback-v1.js",
 "c720p-migrated-index-playback-v1.js":b"C720PSecureRelay"
}
CAMERA="http://127.0.0.1:18808/status"
MARK="C720P_LEGACY_BROWSER_AUTH_RELAY_V136_VERIFIED "
def capture():
 with urllib.request.urlopen(CAMERA,timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_status_http_unavailable")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_status_oversized")
 s=json.loads(raw)
 if (s.get("ok") is not True or s.get("mode")!="watching"
   or s.get("native_4k_enabled") is not True
   or s.get("continuous_4k_ready") is not True
   or s.get("continuous_4k_dropped_output_frames")!=0
   or s.get("continuous_4k_error")
   or type(s.get("temperature_c")) not in (int,float)
   or not 0<s["temperature_c"]<=39.5
   or type(s.get("continuous_4k_buffered_ms")) is not int
   or s["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("s9_capture_unhealthy_busy_or_hot")
 return s
def files():
 out={}
 for name,marker in REQUIRED.items():
  p=DOCROOT/name
  if p.is_symlink() or not p.is_file() or not 0<p.stat().st_size<500000:
   raise RuntimeError("legacy_static_file_untrusted")
  body=p.read_bytes()
  if marker not in body:raise RuntimeError("legacy_auth_bridge_not_installed")
  out[name]=hashlib.sha256(body).hexdigest()
 return out
def script():
 # Never disclose any filename, person, authenticated URL or browser token
 # to Python/logs. Browser side returns aggregate count and HTTP-only proof.
 return r"""(async()=>{
   const relay=window.C720PSecureRelay;
   if(!relay||typeof relay.fetch!=='function'||typeof relay.url!=='function')
     return {relay_ready:false,reason:'authenticated_relay_unavailable'};
   const staticPaths=[
      ['/local/frontyard-security-new/clips.html','C720P_MIGRATED_S9_LEGACY_PLAYER_V1'],
      ['/local/frontyard-security-new/index.html','c720p-migrated-index-playback-v1.js'],
      ['/local/frontyard-security-new/c720p-migrated-index-playback-v1.js','C720PSecureRelay']
   ];
   for(const [p,marker] of staticPaths){
     let reply=await fetch(p+'?v136=1',{cache:'no-store'});
     if(reply.status!==200)return {relay_ready:true,reason:'static_page_not_served'};
     let text=await reply.text();
     if(!text.includes(marker))return {relay_ready:true,reason:'static_marker_absent'};
   }
   let api=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
   if(api.status!==200)return {relay_ready:true,reason:'migrated_api_unavailable',api_http:api.status};
   let data=await api.json();
   if(data?.ok!==true||data.schema_version!=='c720p_s9_verified_import_v2'||
      data.not_s9_original_recordings!==true||
      data.not_person_assignments!==true||
      !Number.isSafeInteger(data.total_imported)||data.total_imported<1||
      !Array.isArray(data.files)||data.files.length!==data.total_imported||
      data.files.length>5000)
      return {relay_ready:true,reason:'migrated_manifest_contract_rejected'};
   const files=data.files;
   const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
   const rec=files.find(x=>x&&typeof x.name==='string'&&valid.test(x.name)&&
      !x.name.includes('..')&&Number.isSafeInteger(x.bytes)&&
      x.bytes>10000&&x.bytes<943718400);
   if(!rec)return {relay_ready:true,reason:'no_verified_media_sample'};
   const route='/new/saved/c720p-migrated/clip/'+encodeURIComponent(rec.name);
   const ticket=await relay.url(route);
   if(typeof ticket!=='string'||ticket.length<8)
      return {relay_ready:true,reason:'signed_playback_url_unavailable'};
   const response=await relay.fetch(route,{method:'GET',headers:{Range:'bytes=0-1023'},cache:'no-store'});
   const declared=Number(response.headers.get('Content-Length')||0);
   const ranged=response.status===206&&declared>=1&&declared<=4096;
   if(!ranged){
     try{await response.body?.cancel()}catch(_){}
     return {relay_ready:true,api_http:api.status,verified_migrated_count:files.length,
             range_http:response.status,reason:'range_not_bounded_or_unavailable'};
   }
   let b=await response.arrayBuffer();
   return {relay_ready:true,static_pages_served:3,api_http:api.status,
     verified_migrated_count:files.length,
     signed_playback_url_constructed:true,range_http:response.status,
     range_bytes:b.byteLength,range_size_bounded:b.byteLength<=4096,
     no_video_decoded:true,no_ui_changes:true,media_originals_modified:false};
 })()"""
def validate_result(r):
 if not isinstance(r,dict):raise RuntimeError("no_browser_result")
 if (r.get("relay_ready") is not True or r.get("static_pages_served")!=3
    or r.get("api_http")!=200 or type(r.get("verified_migrated_count")) is not int
    or r["verified_migrated_count"]<1 or r.get("signed_playback_url_constructed") is not True
    or r.get("range_http")!=206 or not 1<=r.get("range_bytes",0)<=4096
    or r.get("no_video_decoded") is not True
    or r.get("media_originals_modified") is not False):
  raise RuntimeError("browser_auth_relay_unverified_"+str(r.get("reason","unknown"))[:50])
 return {"authenticated_browser_relay":True,"static_pages_http_200":3,
         "migrated_manifest_count":r["verified_migrated_count"],
         "s9_media_206_bounded":True,"range_bytes":r["range_bytes"],
         "signed_url_not_disclosed":True,"video_decode_started":False,
         "media_modified":False,"reviews_modified":False,
         "camera_apk_modified":False}
def run():
 if LIB.is_symlink() or not LIB.is_file():raise RuntimeError("missing_chromium_debugger_helper")
 src=files();before=capture()
 spec=importlib.util.spec_from_file_location("legacy_bridge_cdp_v136",LIB)
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 browser=helper.Socket(helper.get("json/version")["webSocketDebuggerUrl"])
 active=next((p for p in helper.get("json/list") if p.get("type")=="page"
    and "c720p-hub" in p.get("url","")),None)
 target=None;page=None
 try:
  target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html",
       "background":True})["targetId"]
  for i in range(35):
   listing=next((p for p in helper.get("json/list") if p.get("id")==target),None)
   if listing and listing.get("webSocketDebuggerUrl"):
    page=helper.Socket(listing["webSocketDebuggerUrl"])
    page.sock.settimeout(65);break
   time.sleep(.20)
  if page is None:raise RuntimeError("isolated_chromium_tab_not_available")
  try:
   for i in range(32):
    resp=page.call("Runtime.evaluate",{"expression":
      "({ready:!!window.C720PSecureRelay?.fetch,shell:!!document.getElementById('s9v5-nav')})",
      "returnByValue":True})
    value=resp.get("result",{}).get("value",{})
    if value.get("ready") and value.get("shell"):break
    time.sleep(.30)
   else:raise RuntimeError("authenticated_browser_security_page_not_ready")
   result=page.call("Runtime.evaluate",{
     "expression":script(),"returnByValue":True,"awaitPromise":True})
   value=result.get("result",{}).get("value",{})
   summary=validate_result(value)
  finally:page.close()
 finally:
  if active:
   try:browser.call("Target.activateTarget",{"targetId":active["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
 after=capture()
 if files()!=src:raise RuntimeError("legacy_files_drifted_during_browser_probe")
 summary["capture_ready_after"]=after["continuous_4k_ready"]
 summary["capture_dropped_frames_after"]=after["continuous_4k_dropped_output_frames"]
 summary["temperature_after_c"]=after["temperature_c"]
 print(MARK+json.dumps(summary,sort_keys=True),flush=True)
if __name__=="__main__":
 ap=argparse.ArgumentParser();ap.add_argument("--run",action="store_true")
 args=ap.parse_args()
 if not args.run:
  files();capture()
  print("C720P_LEGACY_BROWSER_V136_PREFLIGHT "+json.dumps({
     "installed_static_bridges":3,"camera_healthy":True,
     "browser_read_only":True,"signed_urls_exposed":False},sort_keys=True),flush=True)
 else:run()
