#!/usr/bin/env python3
"""Short stepwise real-kiosk V9 playback checks in temporary tab; restore home."""
import importlib.util,time,json
from pathlib import Path
LIB=Path('/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py')
spec=importlib.util.spec_from_file_location('s9_cdp',LIB)
cdp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cdp)
browser=cdp.Socket(cdp.get('json/version')['webSocketDebuggerUrl'])
home=next((x for x in cdp.get('json/list') if x.get('type')=='page' and 'c720p-hub' in x.get('url','')),None)
target=None;page=None
def read(js):
 x=page.call('Runtime.evaluate',{'expression':js,'returnByValue':True})
 if x.get('exceptionDetails'):return {'exception':str(x['exceptionDetails'])[:300]}
 return x.get('result',{}).get('value')
try:
 target=browser.call('Target.createTarget',{'url':'http://localhost:8123/local/c720p-surveillance.html','background':True})['targetId']
 for i in range(50):
  obj=next((x for x in cdp.get('json/list') if x.get('id')==target),None)
  if obj and obj.get('webSocketDebuggerUrl'):
   page=cdp.Socket(obj['webSocketDebuggerUrl']);break
  time.sleep(.2)
 if not page:raise RuntimeError('no_security_target')
 browser.call('Target.activateTarget',{'targetId':target})
 for n in range(24):
  try:
   d=read("({href:location.href,ready:!!document.querySelector('#s9v5-nav button[data-view=evidence]')})")
   if d and d.get('ready'):break
  except RuntimeError:pass
  time.sleep(.3)
 print('V9_CDP_TAB_BEFORE',json.dumps(d),flush=True)
 if not d or not d.get('ready'):raise RuntimeError('Security_nav_not_present')
 try:
  clicked=read("document.querySelector('#s9v5-nav button[data-view=evidence]').click(); true")
  print('V9_CDP_TAB_CLICK',clicked,flush=True)
 except RuntimeError as error:print('V9_CDP_TAB_CLICK_CONTEXT_CHANGE',str(error)[:160],flush=True)
 for i in range(60):
  try:
   d=read("""({
      href:location.href,view:document.querySelector('#s9v5-shell')?.dataset.view,
      pane:!!document.querySelector('#s9v8-evidence iframe'),
      frameLoaded:document.querySelector('#s9v8-evidence iframe')?.contentDocument?.readyState,
      frameTitle:document.querySelector('#s9v8-evidence iframe')?.contentDocument?.title,
      frameSrc:document.querySelector('#s9v8-evidence iframe')?.getAttribute('src'),
      frameHref:document.querySelector('#s9v8-evidence iframe')?.contentWindow?.location?.href,
      items:document.querySelector('#s9v8-evidence iframe')?.contentDocument?.querySelectorAll('#list .clip')?.length||0,
      smoothController:!!document.querySelector('#s9v8-evidence iframe')?.contentWindow?.C720PSecurityVideo
    })""")
   if d and d.get('items',0)>0:break
  except RuntimeError:pass
  time.sleep(.35)
 print('V9_CDP_TAB_AFTER_CLICK',json.dumps(d),flush=True)
 if not d or not d.get('pane'):raise RuntimeError('evidence_pane_not_present')
 if d.get('items',0)<1:
  print('V9_CDP_NO_INDEXED_EVIDENCE',flush=True)
 else:
  prepared=read("""(()=>{
   const doc=document.querySelector('#s9v8-evidence iframe').contentDocument;
   const s=doc.querySelector('#search');
   s.value='motion_1791740141770.mp4';
   s.dispatchEvent(new Event('input',{bubbles:true}));
   doc.querySelector('#list .clip')?.click();
   return {chosen:doc.querySelector('#list .clip')?.dataset.clip,
    player:!!doc.querySelector('#detail video'),
    controller:!!document.querySelector('#s9v8-evidence iframe').contentWindow.C720PSecurityVideo}
  })()""")
  print('V9_CDP_EVIDENCE_CHOSEN',json.dumps(prepared),flush=True)
  time.sleep(2)
  readback=read("""(()=>{
    const f=document.querySelector('#s9v8-evidence iframe');
    const video=f.contentDocument?.querySelector('#detail video');
    return {href:location.href,frameTitle:f.contentDocument?.title,
      videoProfile:video?.dataset.securityProfile||null,
      videoSource:video?.currentSrc||null,
      playable:video?.readyState??null,
      controllerPresent:!!f.contentWindow.C720PSecurityVideo,
      browserError:video?.error?.message||null};
  })()""")
  print('V9_CDP_EVIDENCE_PLAYER',json.dumps(readback),flush=True)
finally:
 if page:page.close()
 if home:
  try:browser.call('Target.activateTarget',{'targetId':home['id']})
  except Exception:pass
 if target:
  try:browser.call('Target.closeTarget',{'targetId':target})
  except Exception:pass
 browser.close()
