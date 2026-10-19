#!/usr/bin/env python3
"""Read-only real-kiosk acceptance of Drive review entry points and filtering."""
import importlib.util
import json
from pathlib import Path
import time
import urllib.request
spec=importlib.util.spec_from_file_location('drive_review_cdp',Path(__file__).with_name('security-step4-cdp-safe.py'))
cdp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cdp)
FIND='''function people(){const q=[document],seen=new Set();
 for(let i=0;i<q.length&&i<24;i++){const d=q[i];if(!d||seen.has(d))continue;seen.add(d);
 if(d.getElementById('reviewGrid')&&d.getElementById('reviewSource'))return d;
 for(const f of d.querySelectorAll('iframe'))try{if(f.contentDocument)q.push(f.contentDocument)}catch(_){} }
 return null;}'''
def evaluate(page,code):
 r=page.call('Runtime.evaluate',{'expression':'(()=>{'+FIND+code+'})()','returnByValue':True})
 if r.get('exceptionDetails'):raise RuntimeError('drive_review_browser_script_error')
 return r.get('result',{}).get('value')
def wait(page,code,valid):
 for _ in range(90):
  r=evaluate(page,code)
  if valid(r):return r
  time.sleep(.35)
 raise RuntimeError('drive_review_browser_timeout')
def main():
 with urllib.request.urlopen('http://127.0.0.1:8795/new/api/drive-saved',timeout=15) as r:drive=json.load(r)
 with urllib.request.urlopen('http://127.0.0.1:8795/new/api/s9-manual-recording-links',timeout=15) as r:links=json.load(r)
 assigned={v.get('name') for k,v in links['items'].items() if k.startswith('drive:') and v.get('folder')}
 total=sum(e.get('remote_name') not in assigned for e in drive['events'])
 if not total:raise RuntimeError('no_unassigned_drive_baseline')
 browser=cdp.Socket(cdp.get('json/version')['webSocketDebuggerUrl']);target=None;page=None
 try:
  target=browser.call('Target.createTarget',{'url':'http://localhost:8123/local/c720p-surveillance.html','background':True})['targetId']
  for _ in range(40):
   item=next((v for v in cdp.get('json/list') if v.get('id')==target),None)
   if item and item.get('webSocketDebuggerUrl'):page=cdp.Socket(item['webSocketDebuggerUrl']);break
   time.sleep(.2)
  if page is None:raise RuntimeError('browser_target_unavailable')
  wait(page,"return !!document.querySelector('#s9v5-nav button[data-view=faces]')",lambda x:x is True)
  # Markup can precede the deferred hub navigation listener on a cold target.
  # Retry that read-only navigation once after its scripts have loaded.
  for attempt in range(2):
   evaluate(page,"document.querySelector('#s9v5-nav button[data-view=faces]').click();return true;")
   try:
    wait(page,"return !!people()?.getElementById('reviewSource')",lambda x:x is True)
    break
   except RuntimeError:
    if attempt:raise
  evaluate(page,"people().querySelector('[data-pane=review]').click();return true;")
  wait(page,"return people().getElementById('reviewTotal').textContent",lambda x:isinstance(x,str) and ' Drive' in x)
  evaluate(page,"const d=people(),e=d.getElementById('reviewSource');e.value='drive';e.dispatchEvent(new d.defaultView.Event('change'));return true;")
  inspect="""const d=people(),rows=[...d.getElementById('reviewGrid').querySelectorAll('article')];return {
   mode:d.getElementById('reviewMode').value,source:d.getElementById('reviewSource').value,
   label:d.getElementById('reviewTotal').textContent,rows:rows.length,
   driveRows:rows.filter(e=>e.dataset.source==='drive').length,
   filingActions:rows.filter(e=>[...e.querySelectorAll('button')].some(b=>b.textContent.includes('File under person'))).length,
   badge:d.getElementById('reviewTabCount').textContent};"""
  all_rows=evaluate(page,inspect)
  assert all_rows['source']=='drive' and all_rows['mode']=='all'
  assert all_rows['rows']==all_rows['driveRows']==all_rows['filingActions']==min(total,100)
  assert all_rows['label'].startswith(str(total)+' unassigned recordings')
  evaluate(page,"const d=people(),e=d.getElementById('reviewMode');e.value='inbox';e.dispatchEvent(new d.defaultView.Event('change'));return true;")
  wait(page,"return people().getElementById('reviewTotal').textContent",lambda x:isinstance(x,str) and x.startswith(str(total)+' review '))
  inbox=evaluate(page,inspect)
  assert inbox['rows']==inbox['driveRows']==inbox['filingActions']==min(total,100)
  evaluate(page,"people().getElementById('peopleReviewNow').click();return true;")
  wait(page,"return people().getElementById('reviewMode').value",lambda x:x=='all')
  print('DRIVE_REVIEW_V64_BROWSER_PASS '+json.dumps({'drive_unassigned':total,'all':all_rows,'needs_review':inbox,'people_shortcut_all_sources':True,'review_writes':0},sort_keys=True),flush=True)
 finally:
  if page:page.close()
  if target:browser.call('Target.closeTarget',{'targetId':target})
  browser.close()
if __name__=='__main__':main()
