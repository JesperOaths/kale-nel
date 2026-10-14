#!/usr/bin/env python3
"""Read-only Drive thumbnail audit in authenticated C720P Chromium.

Opens temporary, inactive Security tab, observes actual archive cards/relay,
and closes it. Never prints signed URLs/tokens, writes no user artifacts.
"""
from __future__ import annotations
import importlib.util,json,time,urllib.request,sys
from pathlib import Path
LIB=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
spec=importlib.util.spec_from_file_location("s9_cdp",LIB)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def evaluate(tab,script,wait=False):
 r=tab.call("Runtime.evaluate",{"expression":script,"returnByValue":True,"awaitPromise":wait})
 if "exceptionDetails" in r:raise RuntimeError("browser_expression_failed:"+str(r["exceptionDetails"].get("text","unknown")))
 return r.get("result",{}).get("value")
def main():
 browser=mod.Socket(mod.get("json/version")["webSocketDebuggerUrl"])
 original=next((r for r in mod.get("json/list") if r.get("type")=="page" and "c720p-hub" in r.get("url","")),None)
 target=None;tab=None
 try:
  target=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html?v=drive-thumb-diag-20261014","background":True})["targetId"]
  for i in range(45):
   row=next((r for r in mod.get("json/list") if r.get("id")==target),None)
   if row and row.get("webSocketDebuggerUrl"):
    tab=mod.Socket(row["webSocketDebuggerUrl"]);tab.sock.settimeout(45);break
   time.sleep(.3)
  if tab is None:raise RuntimeError("no_chromium_page_socket")
  for i in range(40):
   ready=evaluate(tab,"Boolean(document.querySelector('#s9v5-nav [data-view=archive]') && window.C720PSecureRelay?.fetch)")
   if ready:break
   time.sleep(.25)
  else:raise RuntimeError("authenticated_security_shell_not_ready")
  evaluate(tab,"document.querySelector('#s9v5-nav [data-view=archive]').click();")
  time.sleep(2)
  evaluate(tab,"(()=>{const f=document.querySelector('#panel-archive iframe');if(f?.contentDocument?.getElementById('driveTab'))f.contentDocument.getElementById('driveTab').click();return !!f?.contentDocument?.getElementById('driveTab')})()")
  time.sleep(5)
  inspect="""(async()=>{
   const f=document.querySelector('#panel-archive iframe'),d=f?.contentDocument;
   const imgs=d?[...d.querySelectorAll('#driveTimeline img')]:[];
   const c=d?.querySelector('#driveTimeline');
   const info={page:location.pathname,frameUrl:f?.getAttribute('src')||null,
     frameAccessible:!!d,frameComplete:d?.readyState||null,
     driveTab:d?.getElementById('driveTab')?.getAttribute('aria-selected'),
     driveStatus:d?.getElementById('driveStatus')?.textContent,
     driveContainerDisplay:c?getComputedStyle(c).display:null,
     cards:d?.querySelectorAll('#driveTimeline button.clip')?.length||0,
     images:imgs.length,loaded:imgs.filter(x=>x.complete&&x.naturalWidth>0).length,
     imgs:imgs.slice(0,8).map(x=>({connected:x.isConnected,srcAssigned:!!x.getAttribute('src'),
       complete:x.complete,naturalWidth:x.naturalWidth,naturalHeight:x.naturalHeight,
       previewReady:x.dataset.drivePreviewReady||null,display:getComputedStyle(x).display,
       currentSrcScheme:(x.currentSrc||x.src||'').split(':')[0],parentTag:x.parentElement?.tagName})),
     scripts:d?[...d.querySelectorAll('script[src]')].map(x=>x.getAttribute('src')).slice(-12):[],
     archiveScriptMarkers:d?.documentElement?.outerHTML.includes('DRIVE_PREVIEW_DOM_ATTACH_FIX_V1')||false};
   if(!window.C720PSecureRelay?.fetch){info.relayStatus='missing';return info;}
   try{
    const a=await window.C720PSecureRelay.fetch('/new/api/drive-saved',{cache:'no-store'});
    info.catalogHttp=a.status;
    const j=await a.json();info.catalogItems=j.events?.length;
    const named=(j.events||[]).find(x=>/^[A-Za-z0-9._-]{1,180}\\.jpg$/i.test(String(x.snapshot_name||'')));
    if(named){
      const path='/new/drive/saved/snap/'+encodeURIComponent(named.snapshot_name);
      try{
       const url=await window.C720PSecureRelay.url(path);
       const r=await fetch(url,{cache:'no-store'});
       const bytes=await r.arrayBuffer();
       info.signedThumbnail={generated:true,http:r.status,contentType:r.headers.get('content-type'),bytes:bytes.byteLength,jpeg:new Uint8Array(bytes).slice(0,2).join(',')==='255,216'};
      }catch(e){info.signedThumbnail={generated:false,error:String(e).slice(0,160)}}
      try{
       const r=await window.C720PSecureRelay.fetch(path,{cache:'no-store'});
       const bytes=await r.arrayBuffer();
       info.relayFetchThumbnail={http:r.status,contentType:r.headers.get('content-type'),bytes:bytes.byteLength,jpeg:new Uint8Array(bytes).slice(0,2).join(',')==='255,216'};
      }catch(e){info.relayFetchThumbnail={error:String(e).slice(0,160)}}
    }
   }catch(e){info.catalogError=String(e).slice(0,150)}
   return info;
  })()"""
  result=evaluate(tab,inspect,True)
  print("ACTUAL_AUTHENTICATED_KIOSK_DRIVE_THUMB_AUDIT",json.dumps(result,sort_keys=True),flush=True)
 finally:
  if tab:tab.close()
  if original:
   try:browser.call("Target.activateTarget",{"targetId":original["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
if __name__=="__main__":main()
