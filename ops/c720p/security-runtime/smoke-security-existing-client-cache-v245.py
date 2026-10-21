#!/usr/bin/env python3
"""Real authenticated existing-client controlled cache-key rotation, no deployment.

Runs inside one disposable, authenticated HA Chromium Security tab, does NOT
edit live HTML/dashboard/scripts or call Save/Delete. Two sequential sandboxed
DOM fixtures reference actual served Security CSS/JS with independent ?v keys.
They are destroyed after checks. Reload proof is limited to controlled
asset-version change; cannot claim spontaneous dashboard auto detection.
"""
import argparse,importlib.util,json
from pathlib import Path
BASE=Path(__file__).with_name("smoke-c720p-migrated-decoded-browser-v145.py")
MARK="SECURITY_CACHE_EXISTING_CLIENT_V245_VERIFIED "
def js():
 return r"""(async()=>{
 const relay=window.C720PSecureRelay;
 const originalNav=document.getElementById('s9v5-nav');
 if(!relay?.fetch || !originalNav)
  return {ok:false,reason:'authenticated_client_not_ready'};
 const originalControls=originalNav.querySelectorAll('button[data-view]').length;
 if(originalControls<3)return {ok:false,reason:'security_controls_missing'};
 const testRoot='/local/c720p-surveillance.html';
 const stamp='v245_acceptance_'+Math.floor(performance.now());
 const versionOld=stamp+'_old',versionNew=stamp+'_new';
 const baseResponse=await fetch(testRoot+'?v='+versionOld,{cache:'no-store'});
 if(baseResponse.status!==200)return {ok:false,reason:'real_entry_asset_missing'};
 const realHTML=await baseResponse.text();
 if(!realHTML.includes('security-hub-v30.js'))
  return {ok:false,reason:'security_js_reference_missing'};
 const make=(key)=>{
  const doc=new DOMParser().parseFromString(realHTML,'text/html');
  let modifiedScripts=0, modifiedStyles=0;
  const scripts=[];
  for(const node of doc.querySelectorAll('script[src],link[rel=stylesheet][href]')){
   const attr=node.tagName.toLowerCase()==='script'?'src':'href';
   const existing=node.getAttribute(attr)||'';
   let parsed;
   try{parsed=new URL(existing,location.href)}catch(e){continue}
   if(parsed.origin!==location.origin||
      !parsed.pathname.startsWith('/local/'))continue;
   parsed.searchParams.set('v',key);
   node.setAttribute(attr,parsed.pathname+parsed.search+parsed.hash);
   if(attr==='src'){modifiedScripts++;scripts.push(parsed.pathname+parsed.search);}
   else modifiedStyles++;
  }
  return {html:'<!doctype html>\n'+doc.documentElement.outerHTML,
    modifiedScripts,modifiedStyles,scripts};
 };
 const first=make(versionOld),second=make(versionNew);
 if(!first.modifiedScripts||!second.modifiedScripts||
    !second.scripts.some(x=>x.includes('security-hub-v30.js?v='+versionNew)))
  return {ok:false,reason:'new_asset_key_not_applied'};
 const iframe=document.createElement('iframe');
 iframe.setAttribute('aria-hidden','true');
 iframe.style.cssText='position:fixed;left:-15000px;top:0;width:550px;height:380px;pointer-events:none';
 document.body.append(iframe);
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const load=async(content)=>{
  const ready=new Promise((resolve,reject)=>{
   const done=()=>resolve(true);
   const failed=()=>reject(new Error('iframe_load_error'));
   iframe.addEventListener('load',done,{once:true});
   iframe.addEventListener('error',failed,{once:true});
  });
  iframe.srcdoc=content;
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(
      ()=>reject(new Error('iframe_load_timeout')),9500))]);
  for(let i=0;i<65;i++){
   try{
    const doc=iframe.contentDocument;
    if(doc?.getElementById('s9v5-nav')?.querySelectorAll('button[data-view]').length>=3)
     return {document:doc,window:iframe.contentWindow};
   }catch(e){return null}
   await wait(150);
  }
  return null;
 };
 let previousMetrics=null,newMetrics=null,sameChecksum=false;
 try{
  const previous=await load(first.html);
  if(!previous)return {ok:false,reason:'old_client_not_rendered'};
  previousMetrics={controls:previous.document.getElementById('s9v5-nav')
    .querySelectorAll('button[data-view]').length,
    css:previous.document.styleSheets.length};
  const priorURL=first.scripts.find(x=>x.includes('security-hub-v30.js?v='));
  const updatedURL=second.scripts.find(x=>x.includes('security-hub-v30.js?v='));
  if(!priorURL||!updatedURL)return {ok:false,reason:'versioned_script_missing'};
  // Check both versioned resources against real server bytes, never synthesize
  // or replace JS/CSS content. Preserve proof that new URL is re-requested.
  const [a,b]=await Promise.all([fetch(priorURL,{cache:'no-store'}),
    fetch(updatedURL,{cache:'no-store'})]);
  if(a.status!==200||b.status!==200)
   return {ok:false,reason:'versioned_asset_http_failure'};
  const [oldBytes,newBytes]=await Promise.all([a.arrayBuffer(),b.arrayBuffer()]);
  if(oldBytes.byteLength!==newBytes.byteLength||oldBytes.byteLength<1000)
   return {ok:false,reason:'asset_content_mismatch'};
  if(!crypto?.subtle?.digest)return {ok:false,reason:'subtle_checksum_unavailable'};
  const digest=async(bytes)=>Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256',bytes))).map(
      n=>n.toString(16).padStart(2,'0')).join('');
  sameChecksum=(await digest(oldBytes))===(await digest(newBytes));
  if(!sameChecksum)return {ok:false,reason:'served_asset_checksum_mismatch'};
  const updated=await load(second.html);
  if(!updated)return {ok:false,reason:'updated_client_not_rendered'};
  newMetrics={controls:updated.document.getElementById('s9v5-nav')
     .querySelectorAll('button[data-view]').length,
    css:updated.document.styleSheets.length};
  const requests=updated.window.performance.getEntriesByType('resource')
    .filter(x=>x.name.includes('security-hub-v30.js') &&
      x.name.includes('v='+versionNew)).length;
  if(requests<1)return {ok:false,reason:'updated_js_request_not_observed'};
  if(newMetrics.controls<previousMetrics.controls||
      previousMetrics.css<1||newMetrics.css<1)
   return {ok:false,reason:'security_controls_or_css_lost'};
  const before=await relay.fetch('/new/api/security-component-health',{cache:'no-store'});
  if(before.status!==200)return {ok:false,reason:'health_api_lost_after_refresh'};
  if(!document.getElementById('s9v5-nav')||
     originalNav.querySelectorAll('button[data-view]').length!==originalControls)
   return {ok:false,reason:'original_client_lost_controls'};
  return {ok:true,existing_client_remained_open:true,
    controlled_version_transition:true,
    changed_js_query_and_fetched_new_asset:true,
    served_old_new_sha256_equal:true,
    before_after_security_controls_present:true,
    stylesheets_rendered_before_after:true,
    updated_js_resource_request_count:requests,
    actual_css_stylesheet_count:newMetrics.css,
    no_review_or_media_changes:true,
    automatic_remote_release_detection_not_claimed:true};
 }catch(e){return {ok:false,reason:'cache_probe_failed_closed'}}
 finally{iframe.remove();}
 })()"""
def validate(value):
 allowed={"authenticated_client_not_ready","security_controls_missing",
   "real_entry_asset_missing","security_js_reference_missing",
   "new_asset_key_not_applied","old_client_not_rendered",
   "versioned_script_missing","versioned_asset_http_failure",
   "asset_content_mismatch","subtle_checksum_unavailable",
   "served_asset_checksum_mismatch","updated_client_not_rendered",
   "updated_js_request_not_observed","security_controls_or_css_lost",
   "health_api_lost_after_refresh","original_client_lost_controls",
   "cache_probe_failed_closed"}
 if not isinstance(value,dict) or value.get("ok") is not True:
  s=str(value.get("reason","unknown")) if isinstance(value,dict) else "unknown"
  raise RuntimeError("security_cache_v245_"+(s if s in allowed else "unknown"))
 expected={"existing_client_remained_open":True,
   "controlled_version_transition":True,
   "changed_js_query_and_fetched_new_asset":True,
   "served_old_new_sha256_equal":True,
   "before_after_security_controls_present":True,
   "stylesheets_rendered_before_after":True,
   "no_review_or_media_changes":True,
   "automatic_remote_release_detection_not_claimed":True}
 if any(value.get(k)!=v for k,v in expected.items()) or (
    type(value.get("updated_js_resource_request_count")) is not int or
    value["updated_js_resource_request_count"]<1 or
    type(value.get("actual_css_stylesheet_count")) is not int or
    value["actual_css_stylesheet_count"]<1):
  raise RuntimeError("security_cache_v245_measured_result_contract_missing")
 return {"authenticated_existing_client_cache_key_rotation_verified":True,
   "js_reloaded_with_new_v_query":True,
   "old_new_script_sha256_equal":True,
   "rendered_css_before_after":True,
   "original_client_controls_preserved":True,
   "no_media_or_review_changes":True,
   "automatic_remote_release_detection_not_tested":True}
if __name__=="__main__":
 ap=argparse.ArgumentParser();ap.add_argument("--run",action="store_true")
 args=ap.parse_args()
 if not args.run:
  print("SECURITY_CACHE_V245_PREVIEW "+json.dumps({"read_only":True,
     "no_live_asset_update":True,"no_existing_tab_destroyed":True}))
 else:
  if BASE.is_symlink() or not BASE.is_file():raise SystemExit(1)
  spec=importlib.util.spec_from_file_location("security_cache_browser_base_v145",BASE)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  mod.js=js;mod.validate=validate;mod.MARK=MARK
  mod.run()
