#!/usr/bin/env python3
"""Live independent Chromium test of reviewed-person appearance evidence.

Only opens a separate background kiosk tab, follows nav and runs GET-only
appearance searches. No assignment, review, video playback, photo export or
camera settings. Only aggregate counts logged; no person names or source IDs.
"""
import importlib.util,json,time
from pathlib import Path

path=Path(__file__).with_name("security-step4-cdp-safe.py")
spec=importlib.util.spec_from_file_location("s9_cdp",path)
cdp=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

FIND=r"""
function peoplePage(){
 const all=[document],seen=new Set();
 for(let i=0;i<all.length&&i<25;i++){
  const d=all[i];if(!d||seen.has(d))continue;seen.add(d);
  if(d.getElementById('savedList')&&d.getElementById('clothingList'))return d;
  for(const f of d.querySelectorAll('iframe')){
   try{if(f.contentDocument)all.push(f.contentDocument)}catch(_){}
  }
 }
 return null;
}
"""

def ev(page,code):
    data=page.call("Runtime.evaluate",{
        "expression":"(() => {"+FIND+code+"})()",
        "returnByValue":True})
    if data.get("exceptionDetails"):
        raise RuntimeError("Browser did not evaluate safely")
    return data.get("result",{}).get("value")

def until(page,code,check,tries=65):
    last=None
    for _ in range(tries):
        try:
            last=ev(page,code)
            if check(last):return last
        except (RuntimeError,TypeError):pass
        time.sleep(.32)
    raise RuntimeError("Live reviewed-appearance browser gate timed out: "+
                       str(last)[:80])

def main():
    ctl=cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
    home=next((t for t in cdp.get("json/list")
               if t.get("type")=="page" and "c720p-hub" in t.get("url","")),None)
    target=None;page=None
    try:
        target=ctl.call("Target.createTarget",{
            "url":"http://localhost:8123/local/c720p-surveillance.html",
            "background":True})["targetId"]
        for _ in range(45):
            o=next((x for x in cdp.get("json/list") if x.get("id")==target),None)
            if o and o.get("webSocketDebuggerUrl"):
                page=cdp.Socket(o["webSocketDebuggerUrl"]);break
            time.sleep(.2)
        if page is None:raise RuntimeError("Background kiosk tab unavailable")
        until(page,"return !!document.querySelector('#s9v5-nav button[data-view=faces]')",
              lambda v:v is True)
        ev(page,"document.querySelector('#s9v5-nav button[data-view=faces]').click();return true")
        people=until(page,"""
         const d=peoplePage(),script=d?.querySelector('script[src*="security-people-v45.js"]');
         return {
           ready:!!d?.getElementById('clothingList')&&!!d?.getElementById('savedList'),
           revision:!!script?.src.includes('reviewed-osnet-v1-20261019'),
           profiles:d?.querySelectorAll('#savedList .profile').length||0,
           fallbackAvailable:!!d?.getElementById('refreshClothing'),
           reviewedOriginals:d?.getElementById('archiveCount')?.textContent||''
         };
        """,lambda v:v and v.get("ready") and v.get("revision")
            and v.get("profiles",0)>0,80)
        assert people["fallbackAvailable"]
        print("S9_REVIEWED_OSNET_KIOSK_SCRIPT_VERIFIED "+
              json.dumps({"profiles":people["profiles"],"revision":people["revision"],
                          "legacy_refresh_present":True}),flush=True)
        ev(page,"""
         const d=peoplePage(),nav=d?.querySelector('button[data-pane="clothing"]');
         if(!nav)throw Error('Outfit comparisons navigation absent');
         nav.click();return true;
        """)
        view=until(page,"""
         const d=peoplePage(),tab=d?.getElementById('clothing'),
           refresh=d?.getElementById('refreshClothing');
         return {visible:!!tab&&!tab.hidden,button:!!refresh,
                 status:d?.getElementById('clothingTotal')?.textContent||''};
        """,lambda v:v and v.get("visible") and v.get("button"))
        ev(page,"""
         peoplePage().getElementById('refreshClothing').click();
         return true;
        """)
        result=until(page,"""
         const d=peoplePage(),el=d?.getElementById('clothingTotal'),
           text=el?.textContent||'',cards=[...d?.querySelectorAll('#clothingList article')||[]];
         const osnet=cards.filter(x=>x.textContent.includes('OSNet 75%')).length,
           legacy=cards.filter(x=>x.textContent.includes('upper ')&&x.textContent.includes('lower ')).length;
         return {status:text,busy:text.includes('Comparing approved reference'),
                 count:cards.length,modelCards:osnet,oldCards:legacy,
                 reviewControls:cards.every(x=>[...x.querySelectorAll('button')].some(b=>
                  b.textContent.includes('Review original')))};
        """,lambda v:v and not v.get("busy") and v.get("status")
           and ("comparison" in v.get("status","").lower()
                or "eligible" in v.get("status","").lower()
                or "reference" in v.get("status","").lower()
                or "index" in v.get("status","").lower()
                or "refresh" in v.get("status","").lower()),90)
        if not result["reviewControls"]:
            raise RuntimeError("Recorded-evidence actions disappeared")
        if result["modelCards"]+result["oldCards"]<result["count"]:
            raise RuntimeError("Unlabelled appearance evidence cards exist")
        print("S9_REVIEWED_OSNET_KIOSK_READONLY_PASS "+
              json.dumps({"cards":result["count"],"osnet_cards":result["modelCards"],
                          "legacy_hsv_cards":result["oldCards"],
                          "all_review_buttons":result["reviewControls"],
                          "one_browser_background_tab":True,
                          "assignments_submitted":0,
                          "recordings_played":0}),flush=True)
    finally:
        if page:
            try:page.close()
            except Exception:pass
        if home:
            try:ctl.call("Target.activateTarget",{"targetId":home["id"]})
            except Exception:pass
        if target:
            try:ctl.call("Target.closeTarget",{"targetId":target})
            except Exception:pass
        ctl.close()

if __name__=="__main__":main()
