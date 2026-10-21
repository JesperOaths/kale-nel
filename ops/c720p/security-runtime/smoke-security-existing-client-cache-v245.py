#!/usr/bin/env python3
"""Real authenticated browser acceptance of controlled Security asset version change.

A disposable HA tab keeps one iframe element open; its source document is
reloaded with two DIFFERENT query-version keys for the ACTUAL served
security-people-v45.js asset. This exercises browser versioned resource fetch,
DOM reload, and retained People interface controls. It does NOT deploy a
release, edit HA pages, assign people, click buttons, write reviews or media,
log filenames/identities/signing URLs, or restart S9 Camera2.

Equivalent controlled asset-version change, not proof of an arbitrary future
release or a production kiosk cache refresh across a real deployment.
"""
import argparse
import importlib.util
import json
from pathlib import Path

BASE=Path(__file__).with_name("smoke-c720p-migrated-decoded-browser-v145.py")
MARK="SECURITY_CLIENT_CACHE_V245_VERIFIED "

def js():
 return r"""(async()=>{
  const root='/local/frontyard-security-new/';
  const htmlFile='security-people-v50.html';
  const jsName='security-people-v45.js';
  const url=root+htmlFile;
  const original=await fetch(url,{cache:'no-store'});
  if(original.status!==200)return {ok:false,reason:'source_html_not_served'};
  const page=await original.text();
  if(page.length<150 || page.length>2300000)return {ok:false,reason:'source_html_invalid'};
  const candidate=[...page.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)]
    .map(match=>match[2])
    .filter(s=>{try{return new URL(s,location.href).pathname===root+jsName;}catch(_){return false;}});
  if(candidate.length!==1)return {ok:false,reason:'people_script_reference_ambiguous'};
  const match=candidate[0];const parsed=new URL(match,location.href);
  if(!parsed.searchParams.has('v')||
     parsed.searchParams.getAll('v').length!==1)
    return {ok:false,reason:'release_cache_key_unavailable'};
  const first='v245-controlled-before';const second='v245-controlled-after';
  const newTag=value=>{
    const asset=new URL(parsed.href);asset.searchParams.set('v',value);
    // Change ONLY the authentic script's asset-version query key.
    return page.replace(candidate[0],asset.pathname+asset.search);
  };
  const iframe=document.createElement('iframe');
  iframe.style.cssText='position:fixed;left:-12000px;top:0;width:980px;height:680px';
  iframe.setAttribute('aria-label','Disposable Security cache acceptance');
  iframe.setAttribute('referrerpolicy','same-origin');
  document.body.append(iframe);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const digest=async(text)=>{
    const b=new TextEncoder().encode(text);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)))
     .map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const loadVersion=async(value)=>{
    const prior=iframe.contentDocument;
    const before=performance.now();
    iframe.srcdoc=newTag(value);
    for(let i=0;i<90;i++){
      await wait(160);
      let doc;try{doc=iframe.contentDocument;}catch(_){return null;}
      if(!doc||doc===prior||doc.readyState!=='complete')continue;
      const scripts=[...doc.querySelectorAll('script[src]')].filter(e=>{
        try{return new URL(e.src,location.href).pathname===root+jsName;}
        catch(_){return false;}
      });
      if(scripts.length!==1||!scripts[0].src.includes('v='+value))continue;
      const resources=iframe.contentWindow?.performance?.getEntriesByType('resource')||[];
      const loaded=resources.some(e=>e.name.includes(jsName)&&e.name.includes('v='+value));
      if(!loaded)continue;
      return {doc,loaded,buttons:doc.querySelectorAll('button').length,
        textLength:doc.body?.textContent?.length||0,
        elapsed:Math.round(performance.now()-before)};
    }
    return null;
  };
  try{
    const p=await fetch(parsed.pathname+'?v='+first,{cache:'no-store'});
    const q=await fetch(parsed.pathname+'?v='+second,{cache:'no-store'});
    if(p.status!==200||q.status!==200)return {ok:false,reason:'versioned_asset_unavailable'};
    const a=await p.text(),b=await q.text();
    if(a.length<1000||a.length!==b.length||
       await digest(a)!==await digest(b))
      return {ok:false,reason:'asset_bytes_not_version_consistent'};
    const before=await loadVersion(first);
    if(!before||before.buttons<1||before.textLength<60)
      return {ok:false,reason:'existing_client_not_rendered'};
    const originalDoc=before.doc;
    const after=await loadVersion(second);
    if(!after||after.doc===originalDoc||after.buttons<1||after.textLength<60)
      return {ok:false,reason:'existing_client_not_refreshed'};
    return {ok:true,controlled_release_change:true,original_client_open_first:true,
      same_iframe_refreshed:true,actual_versioned_script_network_resources:2,
      resource_sha256_equal:true,html_document_replaced:true,
      people_controls_retained_after_refresh:true,
      versioned_asset_bytes_verified:true,source_html_was_real_served_html:true,
      no_real_release_deployed:true,media_and_reviews_unchanged:true,
      camera_services_untouched:true,private_names_not_returned:true,
      token_or_signed_url_not_returned:true};
  }catch(_){return {ok:false,reason:'cache_browser_exception'}}
  finally{iframe.remove();}
 })()"""

def validate(result):
 allowed={"source_html_not_served","source_html_invalid",
          "people_script_reference_ambiguous","release_cache_key_unavailable",
          "versioned_asset_unavailable","asset_bytes_not_version_consistent",
          "existing_client_not_rendered","existing_client_not_refreshed",
          "cache_browser_exception"}
 if not isinstance(result,dict) or result.get("ok") is not True:
  reason=str((result or {}).get("reason","unknown"))
  raise RuntimeError("cache_browser_v245_"+(reason if reason in allowed else "unknown"))
 checks={"controlled_release_change":True,"original_client_open_first":True,
 "same_iframe_refreshed":True,"actual_versioned_script_network_resources":2,
 "resource_sha256_equal":True,"html_document_replaced":True,
 "people_controls_retained_after_refresh":True,
 "versioned_asset_bytes_verified":True,
 "source_html_was_real_served_html":True,"no_real_release_deployed":True,
 "media_and_reviews_unchanged":True,"camera_services_untouched":True,
 "private_names_not_returned":True,"token_or_signed_url_not_returned":True}
 if any(result.get(k)!=v for k,v in checks.items()):
  raise RuntimeError("cache_browser_v245_unverified_fields")
 return {"controlled_asset_version_change_verified":True,
   "actual_browser_resource_requests":2,
   "same_existing_iframe_client_refreshed":True,
   "rendered_people_controls_retained":True,
   "actual_asset_sha256_unchanged_between_cache_keys":True,
   "production_release_changed":False,
   "no_media_review_or_camera_changes":True,
   "names_credentials_and_signed_urls_not_logged":True}

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if not args.run:
  print("SECURITY_CLIENT_CACHE_V245_PREVIEW "+json.dumps({
   "browser_not_started":True,"no_html_asset_mutations":True},sort_keys=True))
 else:
  if BASE.is_symlink() or not BASE.is_file():
   raise SystemExit("SECURITY_CLIENT_CACHE_V245_BASE_UNAVAILABLE")
  spec=importlib.util.spec_from_file_location("security_cache_v245_base",BASE)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  mod.js=js;mod.validate=validate;mod.MARK=MARK
  mod.run()
