#!/usr/bin/env python3
"""Guarded live UI/metadata repair; preserve newer models, originals and reviews."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.request
BASE=Path('/home/jespern/c720p-home-hub')
WWW=Path('/opt/homeassistant/config/www')
ROOT=WWW/'frontyard-security-new'
BEFORE='7cd6659c3268a6d6fe52f6e9d096a12b6061a1c3'
TAG='security-filing-v65-20261019'
PREFIX='ops/c720p/s9-native-security/'
LIVE_JS='dd9c539b4e13ed36ee79734a5a1c133e42b6b4d91bb22f178c17346ec26a4aa3'
LIVE_BACKEND='312642b99bbdede12a0ed3069a3c1e6080ef9061d3045da9b2287c48873c3085'
LIVE_RELAY='ba7d23ddfb440a38aa53221ac9b72024a4183984582c9de96b6e60933107c635'
ASSETS={'js':ROOT/'security-people-v45.js','people':ROOT/'security-people-v50.html',
 'hub':ROOT/'security-hub-v30.js','entry':ROOT/'security-hub-v30.html','shell':WWW/'c720p-surveillance.html',
 'backend':BASE/'bin/s9_manual_recording_links.py','relay':BASE/'bin/c720p-lan-camera-relay.py'}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(url,bound=6000000):
 with urllib.request.urlopen(url,timeout=25) as response:raw=response.read(bound+1)
 if len(raw)>bound:raise RuntimeError('oversized_response')
 return raw
def src(ref,path):return read('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+ref+'/'+path).decode()
def one(text,old,new):
 if not old or old==new or text.count(old)!=1:raise RuntimeError('changed_patch_anchor')
 return text.replace(old,new,1)
def block(t,start,end):
 a=t.index(start);return t[a:t.index(end,a)]
def patch_js(live,old,new):
 text=live.decode()
 for start,end in (
  ('function assignmentKey(item){','function makeArchiveRows(){'),
  ('async function fetchExtraLinks(){','async function fetchDriveArchive(){'),
  ('async function refreshArchiveReviewSources(','function actualFolder(){'),
  ('async function loadView(){','async function fetchFaces(){'),
  ('function openApproval(item){','function dismiss(item){'),
  ('function reviewItem(item,compact){','function portraitKey(id){'),
  ('function renderReview(){','function renderPeople(){'),
  ("$('approvalForm').addEventListener", "$('folderForm').addEventListener")):
  text=one(text,block(old,start,end),block(new,start,end))
 text=one(text,'legacyAssigned:new Map(),','legacyAssigned:new Map(),legacySkipped:new Map(),')
 # Other live-only additions (OSNet, unique-original counters, health) stay intact.
 for marker in ('fetchAutomatic','approvedFolderContext','faceFetchError','fetchLegacySkipped','review_status'):
  if marker not in text:raise RuntimeError('lost_existing_feature')
 return text.encode()
def patch_relay(raw):
 t=raw.decode();start="  if path=='/new/api/s9-manual-recording-links':"
 end="  parts=path.strip('/').split('/')"
 old=block(t,start,end);new=old
 new=one(new,"('assign','return_to_queue')","('assign','return_to_queue','skip','reject')")
 # Preserve the outer origin/auth/intent checks. The validated internal hop
 # uses a canonical origin; browser ports/LAN names aren't upstream origins.
 new=one(new,"if self.headers.get('Origin'):header['Origin']=self.headers['Origin']",
  "header['Origin']='http://127.0.0.1' # validated authenticated relay origin")
 new=one(new,"('','same-origin','none')","('','same-origin','same-site','none')")
 return one(t,old,new).encode()
def cache(text,asset):
 pattern=re.escape(asset)+r'\?v=[A-Za-z0-9._-]+'
 if len(re.findall(pattern,text))!=1:raise RuntimeError('changed_cache_route_'+asset)
 return re.sub(pattern,asset+'?v='+TAG,text).encode()
def atom(path,data,mode):
 fd,tmp=tempfile.mkstemp(prefix='.security-filing-v65-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def api(port,path):return json.loads(read('http://127.0.0.1:'+str(port)+path))
def inventory():
 result={}
 for kind,path in [('sd','/new/api/saved'),('drive','/new/api/drive-saved')]:
  d=api(8795,path)
  if d.get('ok') is not True or not isinstance(d.get('events'),list) or not d['events']:raise RuntimeError('archive_unavailable')
  result[kind]={str(x.get('clip_no' if kind=='sd' else 'remote_name')) for x in d['events']}
 return result
def reviews():
 return {n:sha(p.read_bytes()) if p.is_file() else None for n in
  ('s9-manual-recording-links-v1.json','s9-manual-recording-links-v1.audit.jsonl',
   's9-auto-person-rejections-v1.json','s9-auto-person-rejections-v1.audit.jsonl')
  for p in [BASE/'state'/n]}
def restart():
 for unit in ('c720p-drive-security-archive.service','c720p-lan-camera-relay.service'):
  subprocess.run(['systemctl','--user','restart',unit],check=True,timeout=60,capture_output=True)
 for _ in range(15):
  try:
   for port in (8794,8795):
    if api(port,'/new/api/s9-manual-recording-links').get('ok') is not True:raise RuntimeError('links_unavailable')
   return
  except Exception:time.sleep(1)
 raise RuntimeError('metadata_services_unhealthy')
def probe():
 # Deliberately nonexistent source: traverse validation without any review write.
 outcomes=[]
 for port in (8794,8795):
  body=json.dumps({'action':'assign','source':'drive','name':'__missing_filing_probe__.mp4',
   'folder':'G_missing_probe','revision':-1,'human_confirmed':True}).encode()
  req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/new/api/s9-manual-recording-links',data=body,
   headers={'Origin':'http://127.0.0.1:8123','Sec-Fetch-Site':'same-site' if port==8794 else 'same-origin',
    'Content-Type':'application/json','X-S9-Manual-Link-Intent':'manual-original-review-links-v1'})
  try:response=urllib.request.urlopen(req,timeout=15)
  except urllib.error.HTTPError as e:response=e
  d=json.load(response)
  if response.status!=404 or d.get('error')!='source_not_in_verified_archive':raise RuntimeError('origin_save_path_probe_failed')
  outcomes.append({'port':port,'status':response.status,'error':d['error']})
 return outcomes
def main():
 p=argparse.ArgumentParser();p.add_argument('--ref',required=True);p.add_argument('--before',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 if any(not re.fullmatch('[a-f0-9]{40}',s) for s in (a.ref,a.before)):raise RuntimeError('immutable_refs_required')
 existing={}
 for key,path in ASSETS.items():
  if not path.is_file() or path.is_symlink():raise RuntimeError('unexpected_live_path')
  existing[key]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
 for k,expected in [('js',LIVE_JS),('backend',LIVE_BACKEND),('relay',LIVE_RELAY)]:
  if sha(existing[k][0])!=expected:raise RuntimeError('concurrent_code_update_'+k)
 before=inventory();decisions=reviews()
 old=src(a.before,PREFIX+'security-people-v45.js');new=src(a.ref,PREFIX+'security-people-v45.js')
 desired={'js':patch_js(existing['js'][0],old,new),
  'backend':src(a.ref,'ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py').encode(),
  'relay':patch_relay(existing['relay'][0])}
 html=existing['people'][0].decode()
 html=one(html,'<option value="skipped">Skipped</option></select>',
  '<option value="skipped">Skipped</option><option value="rejected">Rejected</option></select>')
 html=one(html,'<p id="approvalClip"','<p id="approvalStatus" class="status" role="alert"></p>\n  <p id="approvalClip"')
 desired['people']=cache(html,'security-people-v45.js')
 for key,asset in [('hub','security-people-v50.html'),('entry','security-hub-v30.js')]:
  desired[key]=cache(existing[key][0].decode(),asset)
 # The outer HA shell can embed the hub directly or use its entry iframe.
 shell=existing['shell'][0];routes=0
 for asset in ('security-people-v50.html','security-hub-v30.js','security-hub-v30.html'):
  if (asset+'?v=').encode() in shell:
   shell=cache(shell.decode(),asset);routes+=1
 if not routes:raise RuntimeError('unknown_outer_shell_route')
 desired['shell']=shell
 for key in ('backend','relay'):compile(desired[key],str(ASSETS[key]),'exec')
 # Validate Python/JS before changing any live file.
 with tempfile.TemporaryDirectory() as tmp:
  js=Path(tmp)/'people.js';js.write_bytes(desired['js']);subprocess.run(['node','--check',str(js)],check=True,capture_output=True)
 print('FILING_V65_PREFLIGHT '+json.dumps({'originals':{k:len(v) for k,v in before.items()},'sha256':{k:sha(v) for k,v in desired.items()},'apply':a.apply}),flush=True)
 if not a.apply:return
 backup=BASE/'backups/security-filing-v65'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,(raw,mode) in existing.items():atom(backup/(key+'-previous'),raw,0o600)
 changed=[]
 try:
  for key,path in ASSETS.items():
   if path.read_bytes()!=existing[key][0]:raise RuntimeError('concurrent_asset_update')
   atom(path,desired[key],existing[key][1]);changed.append(key)
  restart();paths=probe();after=inventory()
  if any(not before[k]<=after[k] for k in before) or decisions!=reviews():raise RuntimeError('original_or_review_changed')
  for key in ('js','people','hub','entry','shell'):
   body=read('http://127.0.0.1:8123/local/'+ASSETS[key].relative_to(WWW).as_posix()+'?v='+TAG)
   if sha(body)!=sha(desired[key]):raise RuntimeError('served_asset_mismatch')
  print('FILING_V65_DEPLOY_VERIFIED '+json.dumps({'originals':{k:len(v) for k,v in after.items()},
   'reviews_unchanged':True,'review_probe_writes':0,'save_path_probes':paths,'backup':str(backup),'camera_changed':False}),flush=True)
 except BaseException:
  for key in reversed(changed):atom(ASSETS[key],*existing[key])
  restart();print('FILING_V65_ROLLED_BACK',flush=True);raise
if __name__=='__main__':main()
