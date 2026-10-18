#!/usr/bin/env python3
"""Read-only real kiosk acceptance of People & Faces Step 4 person folders.

Only clicks navigation, opens saved folders and optional face preview dialogs.
No form submission, assignments, identity grouping, playback, or media changes.
Aggregated source counts only; no names, faces, URLs or identifiers printed.
"""
import importlib.util
import json
from pathlib import Path
import time

lib = Path(__file__).with_name("security-v8-real-browser-probe.py")
spec = importlib.util.spec_from_file_location("s9_step4_cdp", lib)
cdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

FIND = r"""
function peopleDoc() {
 const all=[document],seen=new Set();
 for(let i=0;i<all.length&&i<24;i++) {
  const d=all[i];if(!d||seen.has(d))continue;seen.add(d);
  if(d.getElementById('savedList')&&d.getElementById('folderGrid'))return d;
  for(const f of d.querySelectorAll('iframe')){
   try{if(f.contentDocument)all.push(f.contentDocument)}catch(_){}
  }
 }
 return null;
}
"""

def evaluate(page, script):
    r = page.call("Runtime.evaluate", {
        "expression": "(() => {" + FIND + script + "})()",
        "returnByValue": True})
    if r.get("exceptionDetails"):
        raise RuntimeError("browser_dom_evaluation_failed")
    return r.get("result", {}).get("value")

def await_value(page, js, valid, tries=60):
    last = None
    for _ in range(tries):
        try:
            last = evaluate(page, js)
            if valid(last):return last
        except (RuntimeError, TypeError):
            pass
        time.sleep(.35)
    raise RuntimeError("step4_browser_timeout_" + str(last)[:120])

def main():
    browser = cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
    home = next((t for t in cdp.get("json/list")
                 if t.get("type")=="page" and "c720p-hub" in t.get("url","")),None)
    target = None
    page = None
    try:
        target = browser.call("Target.createTarget", {
            "url": "http://localhost:8123/local/c720p-surveillance.html",
            "background": True})["targetId"]
        for _ in range(60):
            obj = next((x for x in cdp.get("json/list") if x.get("id")==target),None)
            if obj and obj.get("webSocketDebuggerUrl"):
                page = cdp.Socket(obj["webSocketDebuggerUrl"])
                break
            time.sleep(.2)
        if page is None:raise RuntimeError("step4_background_tab_not_created")
        await_value(page, """
         return !!document.querySelector('#s9v5-nav button[data-view=faces]');
        """,lambda r:r is True,60)
        evaluate(page,"""
         document.querySelector('#s9v5-nav button[data-view=faces]').click();
         return true;
        """)
        ready=await_value(page,"""
         const d=peopleDoc();
         const script=d?.querySelector('script[src*="security-people-v45.js"]');
         return {
          loaded:!!d?.getElementById('savedList'),
          people:d?.querySelectorAll('#savedList .profile').length||0,
          updated:!!script?.src.includes('security-step4-v59-20261019'),
          review:d?.getElementById('viewerFile')!==null,
          sources:d?.getElementById('archiveCount')?.textContent||''
         };
        """,lambda v:v and v.get("loaded") and v.get("people",0)>0 and v.get("updated"),80)
        assert ready["review"]
        print("STEP4_V59_BROWSER_PEOPLE",json.dumps(ready,sort_keys=True),flush=True)
        # Each profile is opened by positional index, but neither person names
        # nor source filenames are persisted in logs.
        count=ready["people"]
        summary=[]
        for i in range(count):
            await_value(page,"""
             const d=peopleDoc();
             return d?.querySelectorAll('#savedList .profile').length||0;
            """,lambda v:v==count)
            profile=evaluate(page, """
             const d=peopleDoc(),cards=[...d.querySelectorAll('#savedList .profile')];
             const b=cards[""" + str(i) + """];if(!b)throw Error('missing saved profile');
             const label=b.querySelector('small')?.textContent||'';
             const count=parseInt(label,10);
             if(!Number.isFinite(count))throw Error('profile count unavailable');
             b.click();
             return {reported:count};
            """)
            assert isinstance(profile["reported"],int)
            folder=await_value(page,"""
             const d=peopleDoc(),f=d?.getElementById('folderView');
             const label=d?.getElementById('folderDescription')?.textContent||'';
             return {
               open:!!f&&!f.hidden,
               description:label,
               title:!!d?.getElementById('folderTitle')?.textContent,
               mode:d?.getElementById('folderMode')?.value||'',
               rows:d?.querySelectorAll('#folderGrid article').length||0
             };
            """,lambda v:v and v.get("open") and v.get("title") and "saved recording links" in v.get("description",""),65)
            # If a new saved person has no reviewed originals yet, still inspect
            # the approved state without generating any review decisions.
            if folder["mode"]!="approved":
                evaluate(page,"""
                 const d=peopleDoc(),f=d.getElementById('folderMode');
                 f.value='approved';f.dispatchEvent(new Event('change',{bubbles:true}));
                 return true;
                """)
            details=await_value(page,"""
             const d=peopleDoc(),txt=d?.getElementById('folderDescription')?.textContent||'';
             const cards=[...d.querySelectorAll('#folderGrid article[data-source]')];
             const keys=cards.map(x=>x.dataset.source+':'+x.dataset.clip);
             const drives=cards.filter(x=>x.dataset.source==='drive');
             const sd=cards.filter(x=>x.dataset.source==='sd');
             return {
              open:!!d?.getElementById('folderView')&&!d.getElementById('folderView').hidden,
              mode:d?.getElementById('folderMode')?.value,
              declared:parseInt(txt,10),
              cards:cards.length,drive:drives.length,sd:sd.length,
              noDuplicates:new Set(keys).size===keys.length,
              driveWithoutNativeFaceStrip:drives.every(x=>!x.querySelector('.review-face-evidence')),
              faces:d?.querySelectorAll('#folderFaceGrid .folder-photo-choice').length||0,
              faceGridVisible:!d?.getElementById('folderFaces')?.hidden,
              returns:cards.filter(x=>[...x.querySelectorAll('button')].some(b=>
               b.textContent.includes('Return to review queue'))).length
             };
            """,lambda v:v and v.get("open") and v.get("mode")=="approved"
                and isinstance(v.get("declared"),int) and v.get("declared")>=0,50)
            assert details["declared"] == profile["reported"],"profile/folder source count drift"
            assert details["noDuplicates"],"duplicate source-qualified recordings"
            assert details["driveWithoutNativeFaceStrip"],"Drive inherited native face evidence"
            assert details["faces"]==0 or details["faceGridVisible"],"hidden face evidence"
            assert details["cards"] <= details["declared"],"folder lists unassigned clips"
            assert details["returns"]==details["cards"],"missing undo action on filed original"
            summary.append({key:details[key] for key in (
                "declared","cards","drive","sd","faces","returns")})
            evaluate(page,"""
             peopleDoc().getElementById('backFolders').click();
             return true;
            """)
        print("STEP4_V59_BROWSER_FOLDERS",json.dumps({
          "checked":count,
          "totalVerifiedLinks":sum(x["declared"] for x in summary),
          "visibleSD":sum(x["sd"] for x in summary),
          "visibleDrive":sum(x["drive"] for x in summary),
          "visibleFaceChoices":sum(x["faces"] for x in summary),
          "peopleWithLinkedClips":sum(x["declared"]>0 for x in summary),
          "allSourceDistinct":True,
          "returnControlsInspected":sum(x["returns"] for x in summary),
          "readOnly":True},sort_keys=True),flush=True)
        print("STEP4_V59_BROWSER_READONLY_ACCEPTANCE_PASS",flush=True)
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

if __name__=="__main__":
    main()
