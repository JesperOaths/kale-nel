#!/usr/bin/env python3
"""Temporary Chromium Security scroll reachability smoke. No backend writes."""
import importlib.util,json,time
from pathlib import Path

source=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
spec=importlib.util.spec_from_file_location("security_scroll_cdp_v12",source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
browser=m.Socket(m.get("json/version")["webSocketDebuggerUrl"])
tab=None;page=None
try:
 tab=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})["targetId"]
 for _ in range(75):
  entries=m.get("json/list")
  item=next((x for x in entries if x.get("id")==tab),None)
  if item and item.get("webSocketDebuggerUrl"):
   page=m.Socket(item["webSocketDebuggerUrl"]);page.sock.settimeout(75);break
  time.sleep(.2)
 if not page:raise RuntimeError("no_temp_cdp_tab")
 browser.call("Target.activateTarget",{"targetId":tab})
 def evaluate(code):
  r=page.call("Runtime.evaluate",{"expression":code,"returnByValue":True})
  if r.get("exceptionDetails"):raise RuntimeError(str(r["exceptionDetails"])[:260])
  return r.get("result",{}).get("value")
 for _ in range(60):
  if evaluate("!!document.querySelector('#s9v5-nav button[data-view=archive]')"):break
  time.sleep(.3)
 checks=[]
 mapping=[
  ("archive","cameraSavedFrame","#archive"),
  ("saved","s9SavedFolderFrame","main"),
  ("faces","s9FacesGalleryFrame","body"),
  ("tracks","s9v7-tracks-frame",".results"),
  ("evidence","evidence","main"),
  ("live","none","#panel-live"),
  ("camera","none","#panel-controls"),
 ]
 for view,frame,selector in mapping:
  switched=evaluate("(()=>{const e=document.querySelector('#s9v5-nav button[data-view="+json.dumps(view)+"]');if(!e)return false;e.click();return true})()")
  if not switched:checks.append({"view":view,"skip":"button missing"});continue
  outcome=None
  for _ in range(22):
   code="""(()=>{
     const name=VIEW,frame=FRAME,selector=SELECTOR;
     let doc=document,el=null;
     if(frame==='evidence'){
      const f=document.querySelector('#s9v8-evidence iframe');doc=f&&f.contentDocument;
     }else if(frame!=='none'){
      const f=document.getElementById(frame);doc=f&&f.contentDocument;
     }
     if(!doc||doc.readyState!=='complete')return {pending:true};
     el=doc.querySelector(selector);
     if(!el||getComputedStyle(el).display==='none'||el.getBoundingClientRect().height<90)
      return {pending:true};
     const existing=doc.getElementById('scroll-v12-test-padding-marker');
     if(existing)existing.remove();
     const mark=doc.createElement('div');mark.id='scroll-v12-test-padding-marker';
     mark.style.cssText='height:870px;width:1px;pointer-events:none;opacity:0';
     el.append(mark);
     el.scrollTop=el.scrollHeight;
     const box=el.getBoundingClientRect(),r=mark.getBoundingClientRect();
     const obj={view:name,target:selector,viewport:Math.round(box.height),
      scrollTop:Math.round(el.scrollTop),max:el.scrollHeight-el.clientHeight,
      bottomMargin:Math.round(box.bottom-r.bottom),
      innerOverflow:getComputedStyle(el).overflowY,
      reachable:el.scrollHeight>el.clientHeight+100&&
       Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight))<=3&&
       r.bottom<=box.bottom+3&&r.bottom>=box.bottom-135};
     mark.remove();el.scrollTop=0;return obj;
    })()""".replace("VIEW",json.dumps(view)).replace("FRAME",json.dumps(frame)).replace("SELECTOR",json.dumps(selector))
   try:outcome=evaluate(code)
   except Exception as err:outcome={"pending":true,"problem":str(err)[:130]}
   if outcome and not outcome.get("pending"):break
   time.sleep(.35)
  checks.append(outcome or {"view":view,"error":"no_result"})
  print("SCROLL_V12_VIEW",json.dumps(checks[-1]),flush=True)
 print("SCROLL_V12_SUMMARY",json.dumps({"tested":len(checks),
   "reachable":sum(x.get("reachable") is True for x in checks),
   "incomplete":[x.get("view","unknown") for x in checks if not x.get("reachable")]},sort_keys=True),flush=True)
 if sum(x.get("reachable") is True for x in checks)<5:raise RuntimeError("too_many_unverified_security_scrollers")
finally:
 if page:page.close()
 if tab:
  try:browser.call("Target.closeTarget",{"targetId":tab})
  except Exception:pass
 browser.close()
