#!/usr/bin/env python3
"""Actual browser + deployed backend, isolated temporary registry, no real reviews."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit
HERE=Path(__file__).resolve().parent
ROOT=Path('/opt/homeassistant/config/www/frontyard-security-new')
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
v=load('v65_verify',HERE/'verify-security-filing-v65.py')
backend=load('v66_isolated_backend',Path('/home/jespern/c720p-home-hub/bin/s9_manual_recording_links.py'))
SD='motion_1792200000000.mp4';DRIVE='historical_fixture.mp4';PERSON='G_SYNTHETIC'
def main():
 real=backend.STORE.read_bytes() if backend.STORE.exists() else None
 with tempfile.TemporaryDirectory(prefix='drive-person-v66-') as folder:
  for key in ('STORE','LOCK','AUDIT','DRIVE'):setattr(backend,key,Path(folder)/key)
  backend.DRIVE.write_text(json.dumps({'items':[{'remote_name':DRIVE,'state':'verified','size':10001}]}))
  html=re.sub(r'<script\b[^>]*>.*?</script>','',ROOT.joinpath('security-people-v50.html').read_text(),flags=re.I|re.S)
  adapter="window.C720PSecureRelay={url:async()=>{throw Error('No fixture media')},fetch:(p,o={})=>fetch(p,o)};"
  html=html.replace('</body>','<script>'+adapter+'</script><script>'+ROOT.joinpath('security-people-v45.js').read_text()+'</script></body>').encode()
  class H(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def js(self,code,data):
    raw=json.dumps(data).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
   def do_GET(self):return self.go()
   def do_POST(self):return self.js(404,{'ok':False})
   def go(self):
    path=urlsplit(self.path).path
    if path=='/fixture':
     self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(html);return
    if path=='/new/api/saved':return self.js(200,{'archive_mode':'S9-microSD-only','events':[{'clip_no':SD,'face_candidates':[]}]})
    if path=='/new/api/drive-saved':return self.js(200,{'ok':True,'events':[{'remote_name':DRIVE,'timestamp':'2026-05-12T08:30:00'}]})
    if path=='/new/api/visual-review':return self.js(200,{'ok':True,'revision':0,'total':0,'items':[],
     'folders':[{'id':PERSON,'label':'Synthetic Drive-only person','approved_clips':0,'suggested_clips':0,'automatic_appearance_group':False}],
     'reference_examples':[],'inbox_clips':0})
    return self.js(404,{'ok':False})
  backend.install(H,lambda:{SD:{}})
  server=ThreadingHTTPServer(('127.0.0.1',0),H);origin='http://127.0.0.1:'+str(server.server_port)
  backend.ORIGINS={origin};threading.Thread(target=server.serve_forever,daemon=True).start()
  browser=v.cdp.Socket(v.cdp.get('json/version')['webSocketDebuggerUrl']);targets=[];pages=[]
  def create():
   target=browser.call('Target.createTarget',{'url':origin+'/fixture','background':True})['targetId'];targets.append(target)
   for _ in range(40):
    row=next((x for x in v.cdp.get('json/list') if x.get('id')==target),None)
    if row and row.get('webSocketDebuggerUrl'):
     page=v.cdp.Socket(row['webSocketDebuggerUrl']);pages.append(page)
     v.wait(page,"return document.getElementById('archiveCount')?.textContent==='2'",bool);return page
    time.sleep(.2)
   raise RuntimeError('fixture_browser_unavailable')
  try:
   page=create();v.evaluate(page,"document.querySelector('[data-pane=review]').click();return true;")
   v.wait(page,"return document.querySelectorAll('#reviewGrid article').length===2",bool)
   v.evaluate(page,"const row=document.querySelector('#reviewGrid article[data-source=drive]');[...row.querySelectorAll('button')].find(b=>b.textContent==='✓ File under person').click();document.getElementById('approvalFolder').value='"+PERSON+"';document.querySelector('#approvalForm button[type=submit]').click();return true;")
   v.wait(page,"return !document.getElementById('approvalDialog').open&&!document.querySelector('#reviewGrid article[data-source=drive]')",bool)
   saved=backend.report();assert saved['revision']==1 and saved['items']['drive:'+DRIVE]['folder']==PERSON
   # New document and fresh API reads: no surviving in-memory assignment state.
   fresh=create();v.evaluate(fresh,"document.querySelector('#savedList button.profile').click();return true;")
   result=v.wait(fresh,"return {mode:document.getElementById('folderMode').value,drive:document.querySelectorAll('#folderGrid article[data-source=drive]').length,count:document.getElementById('folderDescription').textContent}",lambda x:isinstance(x,dict) and x.get('drive')==1)
   assert result['mode']=='approved' and result['count'].startswith('1 saved recording links')
   v.evaluate(fresh,"[...document.querySelectorAll('#folderGrid button')].find(b=>b.textContent==='↩ Return to review queue').click();return true;")
   v.wait(fresh,"return !document.querySelector('#folderGrid article[data-source=drive]')",bool)
   assert backend.report()['revision']==2 and backend.report()['items']['drive:'+DRIVE]['folder'] is None
   actual=Path('/home/jespern/c720p-home-hub/state/s9-manual-recording-links-v1.json')
   unchanged=(actual.read_bytes() if actual.exists() else None)==real
   print('DRIVE_PERSON_V66_BROWSER_PERSISTENCE_PASS '+json.dumps({'disk_save_verified':True,'fresh_document_person_view':result,
    'return_to_queue_verified':True,'synthetic_audit_rows':len(backend.AUDIT.read_text().splitlines()),
    'real_review_writes':0,'real_registry_unchanged':unchanged}),flush=True)
  finally:
   for page in pages:page.close()
   for target in targets:browser.call('Target.closeTarget',{'targetId':target})
   browser.close();server.shutdown();server.server_close()
if __name__=='__main__':main()
