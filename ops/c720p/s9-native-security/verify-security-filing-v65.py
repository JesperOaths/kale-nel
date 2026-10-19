#!/usr/bin/env python3
"""Real Chromium UI acceptance with isolated fake reviews and zero real decisions."""
import importlib.util
import json
from pathlib import Path
import re
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path('/opt/homeassistant/config/www/frontyard-security-new')
spec=importlib.util.spec_from_file_location('filing_cdp',Path(__file__).with_name('security-step4-cdp-safe.py'))
cdp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cdp)
FIND="""function people(){const q=[document],seen=new Set();for(let i=0;i<q.length&&i<24;i++){
 const d=q[i];if(!d||seen.has(d))continue;seen.add(d);if(d.getElementById('reviewGrid')&&d.getElementById('reviewSource'))return d;
 for(const f of d.querySelectorAll('iframe'))try{if(f.contentDocument)q.push(f.contentDocument)}catch(_){}}return null;}"""
def evaluate(page,code,async_=False):
 r=page.call('Runtime.evaluate',{'expression':(' (async()=>{' if async_ else '(()=>{')+FIND+code+'})()',
  'returnByValue':True,'awaitPromise':async_})
 if r.get('exceptionDetails'):raise RuntimeError('browser_script_failed '+str(r['exceptionDetails'])[:150])
 return r.get('result',{}).get('value')
def wait(page,code,valid):
 for _ in range(100):
  result=evaluate(page,code)
  if valid(result):return result
  time.sleep(.25)
 raise RuntimeError('browser_acceptance_timeout')
FIXTURE=r"""
window.fixture={revision:0,items:{},writes:[],hold:false,release:null};
const sd='motion_1792200000000.mp4',drive='historical_fixture.mp4';
window.C720PSecureRelay={url:async()=>{throw Error('No media access in fixture')},fetch:async(path,options={})=>{
 const f=window.fixture;const response=data=>({ok:true,status:200,json:async()=>data});
 if(path==='/new/api/s9-manual-recording-links'){
  if(options.method==='POST'){
   const b=JSON.parse(options.body);if(b.revision!==f.revision)throw Error('stale fixture');
   const status=({assign:'assigned',return_to_queue:'inbox',skip:'skipped',reject:'rejected'})[b.action];
   f.items[b.source+':'+b.name]={source:b.source,name:b.name,folder:b.folder,review_status:status};
   f.revision++;f.writes.push(b);
   return response({ok:true,revision:f.revision,folder:b.folder,review_status:status});
  }
  if(f.hold)await new Promise(resolve=>f.release=resolve);
  return response({ok:true,revision:f.revision,items:structuredClone(f.items),manual_links_only:true});
 }
 if(path==='/new/api/drive-saved')return response({ok:true,events:[{remote_name:drive,timestamp:'2026-05-12T08:30:00'}]});
 if(path==='/new/api/saved')return response({archive_mode:'S9-microSD-only',events:[{clip_no:sd,face_candidates:[]}]});
 if(path.startsWith('/new/api/visual-review?'))return response({ok:true,revision:0,total:0,items:[],inbox_clips:0,
  folders:[{id:'G_FIXTURE',label:'Synthetic reviewer fixture',automatic_appearance_group:false,approved_clips:0}],reference_examples:[]});
 if(path==='/new/api/automatic-person')return response({ok:true,status:'ready',revision:0,items:[]});
 throw Error('Unexpected fixture read');
}};
"""
def fixture_server():
 html=ROOT.joinpath('security-people-v50.html').read_text()
 html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S|re.I)
 script=ROOT.joinpath('security-people-v45.js').read_text()
 html=html.replace('</body>','<script>'+FIXTURE+'</script><script>'+script+'</script></body>')
 raw=html.encode()
 class Handler(BaseHTTPRequestHandler):
  def do_GET(self):
   self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(raw)
  def log_message(self,*args):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
 threading.Thread(target=server.serve_forever,daemon=True).start();return server

def main():
 browser=cdp.Socket(cdp.get('json/version')['webSocketDebuggerUrl']);targets=[];pages=[];server=None
 def create(url):
  target=browser.call('Target.createTarget',{'url':url,'background':True})['targetId'];targets.append(target)
  for _ in range(40):
   row=next((x for x in cdp.get('json/list') if x.get('id')==target),None)
   if row and row.get('webSocketDebuggerUrl'):
    page=cdp.Socket(row['webSocketDebuggerUrl']);pages.append(page);return page
   time.sleep(.2)
  raise RuntimeError('target_unavailable')
 try:
  # Production UI and authenticated route; nonexistent source guarantees no write.
  page=create('http://localhost:8123/local/c720p-surveillance.html')
  wait(page,"return !!document.querySelector('#s9v5-nav button[data-view=faces]')",bool)
  for attempt in range(2):
   evaluate(page,"document.querySelector('#s9v5-nav button[data-view=faces]').click();return true;")
   try:wait(page,"return !!people()?.getElementById('approvalStatus')",bool);break
   except RuntimeError:
    if attempt:raise
  evaluate(page,"people().querySelector('[data-pane=review]').click();return true;")
  wait(page,"return people().getElementById('reviewTotal').textContent",lambda s:isinstance(s,str) and ' Drive' in s)
  live=evaluate(page,"""const d=people(),rows=[...d.querySelectorAll('#reviewGrid article')];return {
   rows:rows.length,skip:rows.filter(e=>[...e.querySelectorAll('button')].some(b=>b.textContent==='↷ Skip for now')).length,
   reject:rows.filter(e=>[...e.querySelectorAll('button')].some(b=>b.textContent==='✕ Reject')).length,
   sourceEnabled:!d.getElementById('reviewSource').disabled,rejectedView:!!d.querySelector('#reviewMode option[value=rejected]')};""")
  assert live['rows']>0 and live['rows']==live['skip']==live['reject'] and live['rejectedView']
  probe=evaluate(page,"""const d=people();let w=d.defaultView,r;for(let i=0;i<5;i++){
   if(w.C720PSecureRelay?.fetch){r=w.C720PSecureRelay;break}w=w.parent;}
   const before=await (await r.fetch('/new/api/s9-manual-recording-links',{cache:'no-store'})).json();
   const res=await r.fetch('/new/api/s9-manual-recording-links',{method:'POST',headers:{'Content-Type':'application/json',
    'X-S9-Manual-Link-Intent':'manual-original-review-links-v1'},body:JSON.stringify({action:'assign',source:'drive',
    name:'__missing_filing_probe__.mp4',folder:'G_missing_probe',revision:-1,human_confirmed:true})});
   const body=await res.json();const after=await (await r.fetch('/new/api/s9-manual-recording-links',{cache:'no-store'})).json();
   return {status:res.status,error:body.error,unchanged:JSON.stringify(before)===JSON.stringify(after)};""",True)
  assert probe=={'status':404,'error':'source_not_in_verified_archive','unchanged':True},probe
  # Isolated original DOM/JS: all writes target the synthetic in-memory registry.
  server=fixture_server();fixture=create('http://127.0.0.1:'+str(server.server_port)+'/fixture')
  wait(fixture,"return !!people()&&document.getElementById('archiveCount').textContent==='2'",bool)
  evaluate(fixture,"document.querySelector('[data-pane=review]').click();return true;")
  wait(fixture,"return document.querySelectorAll('#reviewGrid article').length",lambda x:x==2)
  for source in ('drive','sd'):
   evaluate(fixture,"const row=document.querySelector('#reviewGrid article[data-source="+source+"]');[...row.querySelectorAll('button')].find(b=>b.textContent==='✓ File under person').click();document.getElementById('approvalFolder').value='G_FIXTURE';window.fixture.hold=true;document.querySelector('#approvalForm button[type=submit]').click();return true;")
   wait(fixture,"return !document.getElementById('approvalDialog').open&&!document.querySelector('#reviewGrid article[data-source="+source+"]')&&!!window.fixture.release",bool)
   evaluate(fixture,"window.fixture.hold=false;window.fixture.release();window.fixture.release=null;return true;")
   time.sleep(.4)
  saved=evaluate(fixture,"return {closed:!document.getElementById('approvalDialog').open,remaining:document.querySelectorAll('#reviewGrid article').length,writes:window.fixture.writes.length}")
  assert saved=={'closed':True,'remaining':0,'writes':2},saved
  print('FILING_V65_BROWSER_PASS '+json.dumps({'live_controls':live,'authenticated_save_probe':probe,
   'synthetic_both_source_saves_before_refresh':saved,'real_review_writes':0}),flush=True)
 finally:
  for page in pages:page.close()
  for target in targets:browser.call('Target.closeTarget',{'targetId':target})
  browser.close()
  if server:server.shutdown();server.server_close()
if __name__=='__main__':main()
