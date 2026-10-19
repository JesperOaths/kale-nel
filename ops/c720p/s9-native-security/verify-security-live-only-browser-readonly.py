#!/usr/bin/env python3
"""Read-only browser acceptance: authenticated native MJPEG and original-only video.

Creates and closes a BACKGROUND kiosk Chrome target. Never plays clips, starts
camera sessions, changes people, reads face pixels or prints private data.
"""
import importlib.util
import json
from pathlib import Path
import time

lib=Path(__file__).with_name("security-step4-cdp-safe.py")
spec=importlib.util.spec_from_file_location("security_live_cdp",lib)
cdp=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

CHECK=r"""(() => {
 const contexts=[window],seen=new Set(),records=[];
 for(let n=0;n<contexts.length&&n<24;n++){
  const w=contexts[n];
  if(seen.has(w))continue;seen.add(w);
  try{
   const live=w.C720PSecurityLiveOnly;
   const compat=w.C720PSecurityVideo;
   if(live||compat){
    records.push({liveVersion:live?.version||null,
      originalMode:compat?.metrics?.mode==='original-only',
      activeLegacySelector:!!w.document.querySelector('.security-video-controls select')});
   }
   for(const frame of w.document.querySelectorAll('iframe')){
    try{if(frame.contentWindow)contexts.push(frame.contentWindow)}catch(_){}
   }
  }catch(_){}
 }
 return {checked:records.length,live:records.some(x=>x.liveVersion===1),
  originalOnly:records.length>0&&records.every(x=>x.originalMode),
  legacyControls:records.some(x=>x.activeLegacySelector)};
})()"""

def main():
 browser=cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
 home=next((x for x in cdp.get("json/list") if x.get("type")=="page" and "c720p-hub" in x.get("url","")),None)
 target=None
 page=None
 try:
  target=browser.call("Target.createTarget",{
   "url":"http://localhost:8123/local/c720p-surveillance.html",
   "background":True})["targetId"]
  for _ in range(60):
   item=next((x for x in cdp.get("json/list") if x.get("id")==target),None)
   if item and item.get("webSocketDebuggerUrl"):
    page=cdp.Socket(item["webSocketDebuggerUrl"]);break
   time.sleep(.2)
  if not page:raise RuntimeError("background_home_security_tab_missing")
  # Live playback script loads only after the Security pane is mounted.
  for _ in range(70):
   response=page.call("Runtime.evaluate",{"expression":
    "!!document.querySelector('#s9v5-nav button[data-view=faces]')",
    "returnByValue":True})
   if response.get("result",{}).get("value") is True:break
   time.sleep(.25)
  else:raise RuntimeError("security_navigation_not_ready")
  page.call("Runtime.evaluate",{"expression":
   "document.querySelector('#s9v5-nav button[data-view=faces]').click();true",
   "returnByValue":True})
  state={}
  for _ in range(80):
   result=page.call("Runtime.evaluate",{"expression":CHECK,"returnByValue":True})
   if result.get("exceptionDetails"):raise RuntimeError("security_live_eval_failed")
   state=result.get("result",{}).get("value") or {}
   if state.get("live") and state.get("originalOnly"):break
   time.sleep(.3)
  print('SECURITY_MJPEG_BROWSER_CONTEXT '+json.dumps(state,sort_keys=True),flush=True)
  assert state.get("live"),"new MJPEG bridge not loaded in active Security frames"
  assert state.get("originalOnly"),"old smooth copy player remains active"
  assert not state.get("legacyControls"),"old quality selector still exposed"
  print("SECURITY_MJPEG_ORIGINAL_ONLY_BROWSER_ACCEPTANCE_PASS "+
        json.dumps(state,sort_keys=True),flush=True)
 finally:
  if page:
   try:page.close()
   except Exception:pass
  if home:
   try:browser.call("Target.activateTarget",{"targetId":home["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()

if __name__=="__main__":main()
