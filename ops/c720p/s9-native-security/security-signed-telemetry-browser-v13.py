#!/usr/bin/env python3
"""Read-only browser-level Security telemetry path audit.

Use the already running authenticated Chromium; create a temporary background
target and restore the original kiosk tab in all cases. Output response status,
a closed set of error types, and only on-phone health scalar fields. Never output
session tokens, URLs, clip data, secrets, HTTP bodies or personal metadata.
"""
import importlib.util
import json
from pathlib import Path
import time

CDP=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
if not CDP.is_file():
    raise RuntimeError("known_chromium_cdp_helper_unavailable")
spec=importlib.util.spec_from_file_location("readonly_cdp",CDP)
lib=importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
browser=lib.Socket(lib.get("json/version")["webSocketDebuggerUrl"])
target=None
page=None
original=next((x for x in lib.get("json/list")
               if x.get("type")=="page" and "c720p-hub" in x.get("url","")),None)

def evaluate(expr,attempts=10):
    for _ in range(attempts):
        try:
            response=page.call("Runtime.evaluate",
                               {"expression":expr,"awaitPromise":True,"returnByValue":True})
            if response.get("exceptionDetails"):
                return {"error":"browser_expression_exception"}
            return response.get("result",{}).get("value")
        except (RuntimeError,TimeoutError,OSError) as error:
            if "context" not in str(error).lower() and "navigation" not in str(error).lower():
                return {"error":type(error).__name__}
            time.sleep(.5)
    return {"error":"browser_context_replaced"}

try:
    target=browser.call("Target.createTarget",{
        "url":"http://localhost:8123/local/c720p-surveillance.html?v=security-telemetry-diagnostic-v13",
        "background":True})["targetId"]
    for _ in range(35):
        match=next((x for x in lib.get("json/list") if x.get("id")==target),None)
        if match and match.get("webSocketDebuggerUrl"):
            page=lib.Socket(match["webSocketDebuggerUrl"])
            break
        time.sleep(.25)
    if page is None:raise RuntimeError("background_browser_tab_unavailable")
    browser.call("Target.activateTarget",{"targetId":target})
    time.sleep(3)
    expression=r"""(async()=>{
       const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
       for(let i=0;i<18&&!document.getElementById('s9v5-nav');i++)await wait(250);
       const relay=window.C720PSecureRelay;
       const out={relayPresent:!!relay,relayFetch:typeof relay?.fetch==='function',
         uiVersion11:!!document.getElementById('s9-security-live-status-v11'),
         uiNavigation:!!document.getElementById('s9v5-nav'),routes:[]};
       if(!relay?.fetch)return out;
       const paths=['/new/api/saved','/new/api/live-person-watch','/new/api/status'];
       for(const path of paths){
         const rec={route:path};
         try{
           const response=await Promise.race([
             relay.fetch(path,{cache:'no-store'}),
             new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),9000))
           ]);
           rec.status=response.status;rec.success=response.ok;
           const type=response.headers?.get('content-type')||'';
           rec.contentType=type.startsWith('application/json')?'json':'other';
           if(type.includes('json')){
             const body=await response.json();
             rec.apiOk=body.ok===true;
             if(path.endsWith('live-person-watch')){
               rec.cameraMode=body.camera_mode||null;
               rec.temperature=Number.isFinite(body.camera_temperature_c)?body.camera_temperature_c:null;
               rec.sensorFps=Number.isFinite(body.camera_sensor?.fps)?body.camera_sensor.fps:null;
               rec.sampleAge=Number.isFinite(body.last_sample_age_ms)?body.last_sample_age_ms:null;
               rec.errorCode=String(body.error||'').slice(0,55)||null;
             }else if(path.endsWith('saved')){
               rec.archiveMode=body.archive_mode||null;
               rec.count=Array.isArray(body.events)?body.events.length:null;
               rec.errorCode=String(body.error||'').slice(0,55)||null;
             }else rec.errorCode=String(body.error||'').slice(0,55)||null;
           }
         }catch(e){rec.clientError=String(e?.name||'Error').slice(0,50)}
         out.routes.push(rec);
       }
       await wait(1000);
       out.liveUi={
         status:document.getElementById('s9v5-status-label')?.textContent?.slice(0,65)||null,
         recorder:document.getElementById('s9v5-rail-mode')?.textContent?.slice(0,65)||null,
         temperature:document.getElementById('s9v5-rail-temp')?.textContent?.slice(0,65)||null,
         sd:document.getElementById('s9v5-rail-sd')?.textContent?.slice(0,65)||null,
         diagnostic:document.getElementById('s9v11-diagnostic')?.textContent?.slice(0,120)||null
       };
       return out;
    })()"""
    observed=evaluate(expression)
    print("S9_SECURITY_SIGNED_TELEMETRY_BROWSER_V13 "+json.dumps(observed,sort_keys=True),flush=True)
finally:
    if page is not None:page.close()
    if original:
        try:browser.call("Target.activateTarget",{"targetId":original["id"]})
        except (OSError,RuntimeError):pass
    if target:
        try:browser.call("Target.closeTarget",{"targetId":target})
        except (OSError,RuntimeError):pass
    browser.close()
