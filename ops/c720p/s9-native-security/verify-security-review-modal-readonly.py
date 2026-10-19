#!/usr/bin/env python3
"""Inspect real Security video modal filing in a background tab without POSTs.

No approval/rejection/assignment requests, video.play(), facial recognition,
camera activity, playback conversion or private filenames are involved.
"""
import importlib.util
import json
from pathlib import Path
import time

lib=Path(__file__).with_name("security-step4-cdp-safe.py")
spec=importlib.util.spec_from_file_location("security_modal_cdp",lib)
cdp=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

FIND=r"""
function peopleDoc(){
 const docs=[document],seen=new Set();
 for(let i=0;i<docs.length&&i<24;i++){
  const d=docs[i];
  if(!d||seen.has(d))continue;seen.add(d);
  if(d.getElementById('folderGrid')&&d.getElementById('viewerFile'))return d;
  for(const f of d.querySelectorAll('iframe')){
   try{if(f.contentDocument)docs.push(f.contentDocument)}catch(_){}
  }
 }
 return null;
}
"""
def evaluate(page,js):
 r=page.call("Runtime.evaluate",{
  "expression":"(() => {"+FIND+js+"})()",
  "returnByValue":True})
 if r.get("exceptionDetails"):raise RuntimeError("security_modal_dom_error")
 return r.get("result",{}).get("value")

def until(page,js,predicate,count=70):
 result=None
 for _ in range(count):
  result=evaluate(page,js)
  if predicate(result):return result
  time.sleep(.35)
 raise RuntimeError("security_modal_readonly_acceptance_timeout")

def main():
 browser=cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
 home=next((x for x in cdp.get("json/list")
            if x.get("type")=="page" and "c720p-hub" in x.get("url","")),None)
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
  if not page:raise RuntimeError("security_modal_background_tab_missing")
  until(page,"return !!document.querySelector('#s9v5-nav button[data-view=faces]')",lambda v:v is True)
  evaluate(page,"document.querySelector('#s9v5-nav button[data-view=faces]').click();return true;")
  until(page,"return peopleDoc()?.querySelectorAll('#savedList .profile').length||0",
        lambda v:isinstance(v,int) and v>0,80)
  evaluate(page,"""const d=peopleDoc();
   const card=d?.querySelector('#savedList .profile');
   if(!card)throw Error('profile_missing');
   card.click();return true;""")
  until(page,"return !!peopleDoc()&&!peopleDoc().getElementById('folderView').hidden",
        lambda v:v is True)
  evaluate(page,"""const d=peopleDoc(),box=d.getElementById('folderMode');
   if(box.value!=='approved'){box.value='approved';
    box.dispatchEvent(new Event('change',{bubbles:true}));}
   return true;""")
  rows=until(page,"""const d=peopleDoc();
   return {count:d?.querySelectorAll('#folderGrid article[data-source]').length||0,
     candidates:[...d?.querySelectorAll('#folderGrid article[data-source]')||[]]
      .filter(x=>[...x.querySelectorAll('button')].some(b=>b.textContent.includes('Play'))).length};""",
   lambda v:bool(v) and v.get("count",0)>0 and v.get("candidates",0)>0,60)
  opened=evaluate(page,"""const d=peopleDoc();
   const card=[...d.querySelectorAll('#folderGrid article[data-source]')]
     .find(x=>[...x.querySelectorAll('button')].some(b=>b.textContent.includes('Play')));
   if(!card)throw Error('original_play_button_missing');
   const play=[...card.querySelectorAll('button')].find(b=>b.textContent.includes('Play'));
   play.click();return true;""")
  assert opened
  modal=until(page,"""const d=peopleDoc(),dialog=d?.getElementById('viewer');
   return {open:!!dialog?.open,file:!d?.getElementById('viewerFile')?.hidden,
    returnVisible:!d?.getElementById('viewerReturn')?.hidden};""",
    lambda v:v and v.get("open") and v.get("file"),65)
  assert modal["returnVisible"],"filed video cannot return to review from popup"
  evaluate(page,"""const d=peopleDoc();d.getElementById('viewerFile').click();return true;""")
  filing=until(page,"""const d=peopleDoc();
   return {closed:!d?.getElementById('viewer')?.open,
    confirmation:!!d?.getElementById('approvalDialog')?.open,
    picker:!!d?.getElementById('approvalFolder'),
    submit:!!d?.querySelector('#approvalForm button[type=submit]')};""",
   lambda v:v and v.get("closed") and v.get("confirmation"),40)
  assert filing["picker"] and filing["submit"],"person-file controls missing in video workflow"
  evaluate(page,"""const d=peopleDoc();
   d.getElementById('approvalCancelFooter').click();
   return !d.getElementById('approvalDialog').open;""")
  print("SECURITY_REVIEW_MODAL_READONLY_ACCEPTANCE_PASS "+json.dumps({
   "originalRows":rows["count"],"videoOpened":True,"fileActionVisible":True,
   "returnActionVisible":True,"filingDialogVisible":True,
   "confirmationCancelled":True,"decisionsModified":False},sort_keys=True),flush=True)
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
