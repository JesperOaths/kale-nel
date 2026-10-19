#!/usr/bin/env python3
"""Read-only C720P browser acceptance for Automatic Person V63.

Runs in a disposable, background Chrome target. Only opens the tab and reads
counts / visible button text. No original clips are played, no faces fetched,
no POSTs are made and no assignments are modified.
"""
import importlib.util
import json
from pathlib import Path
import time

cdp_file=Path(__file__).with_name("security-step4-cdp-safe.py")
spec=importlib.util.spec_from_file_location("auto_person_cdp",cdp_file)
cdp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cdp)

FIND=r"""
function findPeople(){
 const found=[document],seen=new Set();
 for(let i=0;i<found.length&&i<24;i++){
  const d=found[i];
  if(!d||seen.has(d))continue;seen.add(d);
  if(d.getElementById("automaticFolders")&&d.getElementById("automaticStatus"))return d;
  for(const frame of d.querySelectorAll("iframe")){
   try{if(frame.contentDocument)found.push(frame.contentDocument)}catch(_){}
  }
 }
 return null;
}
"""
def eval_script(page,script):
 result=page.call("Runtime.evaluate",{
  "expression":"(() => {"+FIND+script+"})()","returnByValue":True})
 if result.get("exceptionDetails"):raise RuntimeError("security_auto_person_cdp_error")
 return result.get("result",{}).get("value")

def until(page,script,valid,attempts=75):
 for _ in range(attempts):
  state=eval_script(page,script)
  if valid(state):return state
  time.sleep(.35)
 raise RuntimeError("security_auto_person_browser_timeout")

def main():
 browser=cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
 home=next((x for x in cdp.get("json/list") if x.get("type")=="page" and
            "c720p-hub" in x.get("url","")),None)
 target=None;page=None
 try:
  target=browser.call("Target.createTarget",{
   "url":"http://localhost:8123/local/c720p-surveillance.html",
   "background":True})["targetId"]
  for _ in range(65):
   item=next((x for x in cdp.get("json/list") if x.get("id")==target),None)
   if item and item.get("webSocketDebuggerUrl"):
    page=cdp.Socket(item["webSocketDebuggerUrl"]);break
   time.sleep(.2)
  if not page:raise RuntimeError("security_auto_person_browser_tab_missing")
  until(page,"return !!document.querySelector('#s9v5-nav button[data-view=faces]')",
        lambda x:x is True)
  eval_script(page,"document.querySelector('#s9v5-nav button[data-view=faces]').click();return true;")
  try:
   until(page,"return !!findPeople()&&!!findPeople().querySelector('[data-pane=automatic]')",
         lambda x:x is True)
  except RuntimeError:
   inventory=eval_script(page,"""const seen=new Set(),queue=[document],found=[];
     for(let i=0;i<queue.length&&i<24;i++){
      const d=queue[i];if(!d||seen.has(d))continue;seen.add(d);
      const div=d.getElementById('reviewGrid');
      const auto=d.querySelector('[data-pane=automatic]');
      const src=d.URL||'';
      found.push({people:!!div,automatic:!!auto,
        children:d.querySelectorAll('iframe').length,
        routeKnown:/security-people-v(?:45|50)[.]html/.test(src)});
      for(const frame of d.querySelectorAll('iframe')){
       try{if(frame.contentDocument)queue.push(frame.contentDocument)}catch(_){}
      }
     }
     return {frames:found};""")
   print("SECURITY_AUTO_PERSON_FRAME_DIAGNOSTIC "+json.dumps(inventory,sort_keys=True),flush=True)
   raise
  eval_script(page,"findPeople().querySelector('[data-pane=automatic]').click();return true;")
  state=until(page,"""const d=findPeople();
   if(!d)return null;
   const pane=d.getElementById('automatic'),nav=d.querySelector('[data-pane=automatic]');
   const status=d.getElementById('automaticStatus').textContent||'';
   const groups=d.getElementById('automaticFolders');
   const buttons=[...groups.querySelectorAll('button')];
   return {paneVisible:!pane.hidden,
     navSelected:nav.getAttribute('aria-selected')==='true',
     loaded:!status.includes('Checking S9+'),
     notReady:status.includes('not ready')||status.includes('not yet'),
     pendingStatus:status.includes('requiring your decision'),
     emptyStatus:status.includes('No new face-based suggestions'),
     groups:groups.querySelectorAll('.auto-person-group').length,
     approvals:buttons.filter(b=>b.textContent.includes('Approve')).length,
     denials:buttons.filter(b=>b.textContent.includes('Deny')).length,
     originalActions:buttons.filter(b=>b.textContent.includes('Play original')).length};
  """,lambda x:bool(x) and x.get("loaded"),90)
  assert state["paneVisible"] and state["navSelected"],"automatic_tab_not_selected"
  assert (state["notReady"] or state["emptyStatus"] or state["pendingStatus"]), "automatic_person_status_unrecognized"
  if state["pendingStatus"]:
   assert state["groups"]>0 and state["approvals"]==state["denials"]==state["originalActions"], "person_review_buttons_missing"
  else:
   assert state["approvals"]==0 and state["denials"]==0, "unexpected_review_controls_without_proposals"
  print("SECURITY_AUTO_PERSON_V63_REAL_BROWSER_ACCEPTANCE_PASS "+
        json.dumps({**state,"reviewWrites":0,"recordingsOpened":0},sort_keys=True),flush=True)
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
