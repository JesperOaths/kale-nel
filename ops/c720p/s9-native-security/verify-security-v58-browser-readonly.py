#!/usr/bin/env python3
"""Read-only live Chromium acceptance for the C720P V58 Security UI.

Opens an isolated background CDP tab, never submits an assignment/review,
never starts playback, and restores the existing kiosk tab on exit. Only
aggregated UI state is printed; no tokens, URLs, images, or filenames.
"""
import importlib.util
import json
import time
from pathlib import Path

SOURCE = Path(__file__).with_name("security-v8-real-browser-probe.py")
spec = importlib.util.spec_from_file_location("s9_browser_cdp", SOURCE)
cdp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdp)

FIND = r"""
function pfDoc() {
  const queue = [document], seen = new Set();
  for (let i = 0; i < queue.length && i < 20; i++) {
    const doc = queue[i];
    if (!doc || seen.has(doc)) continue;
    seen.add(doc);
    if (doc.getElementById('reviewGrid') && doc.getElementById('pageSize')) return doc;
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) queue.push(frame.contentDocument) } catch (_) {}
    }
  }
  return null;
}
"""
def eval_js(page, script):
    payload = page.call("Runtime.evaluate", {"expression": script, "returnByValue": True})
    if payload.get("exceptionDetails"):
        raise RuntimeError("browser_expression_failed")
    return payload.get("result", {}).get("value")

def probe(page, code):
    return eval_js(page, "(() => {" + FIND + code + "})()")

def wait(page, code, predicate, tries=50):
    last = None
    for _ in range(tries):
        try:
            last = probe(page, code)
            if predicate(last): return last
        except (RuntimeError, TypeError):
            pass
        time.sleep(0.4)
    raise RuntimeError("browser_timeout_" + str(last)[:140])

def main():
    browser = cdp.Socket(cdp.get("json/version")["webSocketDebuggerUrl"])
    home = next((p for p in cdp.get("json/list") if p.get("type") == "page"
                 and "c720p-hub" in p.get("url", "")), None)
    target, page = None, None
    try:
        target = browser.call("Target.createTarget", {
            "url": "http://localhost:8123/local/c720p-surveillance.html",
            "background": True})["targetId"]
        for _ in range(50):
            tab = next((p for p in cdp.get("json/list") if p.get("id") == target), None)
            if tab and tab.get("webSocketDebuggerUrl"):
                page = cdp.Socket(tab["webSocketDebuggerUrl"])
                break
            time.sleep(0.2)
        if page is None: raise RuntimeError("browser_target_missing")

        nav = wait(page, """
          return {ready: !!document.querySelector('#s9v5-nav button[data-view=faces]'),
                  archive: !!document.querySelector('#s9v5-nav button[data-view=archive]')};
        """, lambda r: r and r.get("ready") and r.get("archive"), 55)
        assert nav["ready"] and nav["archive"]
        probe(page, """
          document.querySelector('#s9v5-nav button[data-view=faces]').click();
          return true;
        """)

        people = wait(page, """
          const d=pfDoc();
          return {ready: !!d && !!d.getElementById('savedList'),
             source: !!d?.querySelector('script[src*="security-people-v45.js"]'),
             options: d?[...d.getElementById('pageSize').options].map(o=>o.value):[],
             viewerFile: !!d?.getElementById('viewerFile'),
             viewerReturn: !!d?.getElementById('viewerReturn'),
             existingPeople: d?.querySelectorAll('#savedList .profile').length||0};
        """, lambda r: r and r.get("ready") and r.get("source")
             and r.get("existingPeople", 0) >= 1, 60)
        assert set(people["options"]) >= {"100", "150", "200"}
        assert people["viewerFile"] and people["viewerReturn"]
        print("SECURITY_V58_BROWSER_PEOPLE", json.dumps(people, sort_keys=True), flush=True)

        probe(page, """
          const d=pfDoc();
          const b=[...d.querySelectorAll('[data-pane]')].find(x=>x.dataset.pane==='review');
          if(!b) throw Error('missing_review_tab');
          b.click();
          return true;
        """)
        review = wait(page, """
          const d=pfDoc();
          const items=[...d.querySelectorAll('#reviewGrid article')];
          return {count:items.length,
            sourceDistinct:items.every(x=>x.dataset.source==='sd'||x.dataset.source==='drive'),
            summary:d.getElementById('reviewTotal')?.textContent||'',
            pageSize:d.getElementById('pageSize')?.value||''};
        """,lambda r:r and r.get("count",0)>=1 and "unassigned recordings" in r.get("summary",""),65)
        assert review["sourceDistinct"]
        assert review["pageSize"]=="100"
        print("SECURITY_V58_BROWSER_REVIEW",json.dumps(review,sort_keys=True),flush=True)

        probe(page, """
          const d=pfDoc(),p=d.getElementById('pageSize');
          p.value='200';p.dispatchEvent(new Event('change',{bubbles:true}));
          return true;
        """)
        expanded = wait(page, """
          const d=pfDoc(),items=[...d.querySelectorAll('#reviewGrid article')];
          return {count:items.length,
            drive:items.filter(x=>x.dataset.source==='drive').length,
            sd:items.filter(x=>x.dataset.source==='sd').length,
            size:d.getElementById('pageSize')?.value,
            summary:d.getElementById('reviewTotal')?.textContent||''};
        """,lambda r:r and r.get("size")=="200" and r.get("count",0)>100,65)
        assert expanded["drive"]>0 and expanded["sd"]>0
        print("SECURITY_V58_BROWSER_BOTH_SOURCES",json.dumps(expanded,sort_keys=True),flush=True)

        # Open a historical Drive video only to inspect controls and metadata.
        # Do not call video.play(), save, return, skip, or submit a review.
        clicked=probe(page, """
          const d=pfDoc();
          const row=[...d.querySelectorAll('#reviewGrid article')].find(x=>x.dataset.source==='drive');
          const b=[...row.querySelectorAll('button')].find(x=>x.textContent.includes('Play'));
          if(!b) throw Error('drive_play_button_missing');
          b.click();return true;
        """)
        assert clicked
        modal=wait(page, """
          const d=pfDoc(),v=d.getElementById('viewer'),
             file=d.getElementById('viewerFile'), ret=d.getElementById('viewerReturn');
          return {viewerOpen:!!v?.open,fileVisible:!!file&&!file.hidden,
                  returnHidden:!!ret?.hidden,
                  videoElement:!!d.getElementById('video')};
        """,lambda r:r and r.get("viewerOpen") and r.get("fileVisible"),40)
        assert modal["returnHidden"] and modal["videoElement"]
        probe(page, """
          const d=pfDoc();
          d.getElementById('viewerFile').click();
          return true;
        """)
        approval=wait(page, """
          const d=pfDoc(),a=d.getElementById('approvalDialog'),
                cancel=d.getElementById('approvalCancelFooter'),rect=cancel?.getBoundingClientRect();
          return {approvalOpen:!!a?.open,peopleOptions:d.getElementById('approvalFolder')?.options?.length||0,
             footerVisible:!!rect&&rect.bottom>0&&rect.top<d.defaultView.innerHeight,
             hasApprovalImage:!!a?.querySelector('img,video')};
        """,lambda r:r and r.get("approvalOpen"),30)
        assert approval["peopleOptions"]>=2
        assert approval["footerVisible"] and not approval["hasApprovalImage"]
        probe(page, """
          const d=pfDoc();
          d.getElementById('approvalCancelFooter').click();
          d.getElementById('closeVideo').click();
          return true;
        """)
        print("SECURITY_V58_BROWSER_MODAL",json.dumps({
            **modal, **approval, "saveSubmitted":False},sort_keys=True),flush=True)

        probe(page, """
          document.querySelector('#s9v5-nav button[data-view=archive]').click();
          return true;
        """)
        archive=wait(page, """
          const q=[document],seen=new Set();
          let a=null;
          for(let i=0;i<q.length&&i<20;i++){
            const doc=q[i];if(!doc||seen.has(doc))continue;seen.add(doc);
            if(doc.getElementById('localTab')&&doc.getElementById('driveTab')){a=doc;break}
            for(const f of doc.querySelectorAll('iframe')){
              try{if(f.contentDocument)q.push(f.contentDocument)}catch(_){}
            }
          }
          return {ready:!!a,sdSelected:a?.getElementById('localTab')?.getAttribute('aria-selected')
                     ||a?.getElementById('localTab')?.getAttribute('aria-pressed')||null,
               driveSelected:a?.getElementById('driveTab')?.getAttribute('aria-selected')
                     ||a?.getElementById('driveTab')?.getAttribute('aria-pressed')||null};
        """,lambda r:r and r.get("ready") and r.get("sdSelected") is not None,50)
        assert archive["sdSelected"]=="true" and archive["driveSelected"]=="false"
        print("SECURITY_V58_BROWSER_ARCHIVE_DEFAULT",json.dumps(archive,sort_keys=True),flush=True)
        print("SECURITY_V58_BROWSER_READONLY_ACCEPTANCE_PASS",flush=True)
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
