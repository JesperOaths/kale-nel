#!/usr/bin/env python3
"""Repair person-folder navigation and counts without touching saved assignments."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import stat
spec=importlib.util.spec_from_file_location('v65_helpers',Path(__file__).with_name('deploy-security-filing-v65.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
BEFORE='49f16744ed1beea14a5db17102f9ade004423230'
LIVE_JS='251d5a46cee563ed35c486485ba1dd26e0268e40b4aa2ee5cdcfdb183c2506d8'
TAG='security-drive-person-v66-20261019'
ASSETS={k:b.ASSETS[k] for k in ('js','people','hub','entry','shell','backend')}
LIVE_BACKEND='8fd8acf7df9d6c3a9f5074168e563a222976099294a6807ec4f503e9270367c3'
def patch_js(live,old,new):
 text=live.decode()
 for start,end in [('async function manualLink(', 'function actualFolder(){'),('function actualFolder(){','function imageFor('),
  ('function openFolder(id,tab,recheckOnly=false){','function openHome('),
  ('function profileRow(f){','function groupRows('),
  ('function renderFolder(){','function facesInRecording(')]:
  current=b.block(text,start,end);replacement=b.block(new,start,end)
  if current!=replacement:text=b.one(text,current,replacement)
 # Preserve the live unique-original counter's surrounding implementation.
 pattern=r"\$\('approvalCount'\)[.]textContent=[^;]+;"
 if len(re.findall(pattern,text))!=1:raise RuntimeError('changed_assignment_counter')
 text=re.sub(pattern,"$('approvalCount').textContent=String(totalAssignedCount());",text)
 old_count="sourceRow('Manual person assignments',String(num(state.doc?.folders?.reduce((count,f)=>\n  count+folderAssignmentCount(f),0))));"
 text=b.one(text,old_count,"sourceRow('Manual person assignments',String(totalAssignedCount()));")
 for feature in ('fetchAutomatic','addReviewedOsnetMatches','manualLink','reviewDecision','fetchLegacySkipped','approvedFolderContext'):
  if feature not in text:raise RuntimeError('existing_feature_missing')
 return text.encode()
def main():
 p=argparse.ArgumentParser();p.add_argument('--ref',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 if not re.fullmatch('[a-f0-9]{40}',a.ref):raise RuntimeError('immutable_ref_required')
 existing={}
 for k,path in ASSETS.items():
  if not path.is_file() or path.is_symlink():raise RuntimeError('unsafe_live_asset')
  existing[k]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
 if b.sha(existing['js'][0])!=LIVE_JS:raise RuntimeError('concurrent_people_ui_update')
 if b.sha(existing['backend'][0])!=LIVE_BACKEND:raise RuntimeError('concurrent_manual_backend_update')
 before=b.inventory();reviews=b.reviews()
 old=b.src(BEFORE,b.PREFIX+'security-people-v45.js');new=b.src(a.ref,b.PREFIX+'security-people-v45.js')
 desired={'js':patch_js(existing['js'][0],old,new),
  'backend':b.src(a.ref,'ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py').encode()}
 compile(desired['backend'],str(ASSETS['backend']),'exec')
 b.TAG=TAG
 for k,asset in [('people','security-people-v45.js'),('hub','security-people-v50.html'),('entry','security-hub-v30.js')]:
  desired[k]=b.cache(existing[k][0].decode(),asset)
 shell=existing['shell'][0];routes=0
 for asset in ('security-people-v50.html','security-hub-v30.js','security-hub-v30.html'):
  if (asset+'?v=').encode() in shell:shell=b.cache(shell.decode(),asset);routes+=1
 if not routes:raise RuntimeError('unknown_shell_route')
 desired['shell']=shell;b.check_js(desired['js'])
 print('DRIVE_PERSON_V66_PREFLIGHT '+json.dumps({'apply':a.apply,'js_sha256':b.sha(desired['js']),
  'originals':{k:len(v) for k,v in before.items()}}),flush=True)
 if not a.apply:return
 backup=b.BASE/'backups/security-drive-person-v66'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for k,(raw,mode) in existing.items():b.atom(backup/(k+'-previous'),raw,0o600)
 changed=[]
 try:
  for k,path in ASSETS.items():
   if path.read_bytes()!=existing[k][0]:raise RuntimeError('concurrent_asset_update')
   b.atom(path,desired[k],existing[k][1]);changed.append(k)
  b.restart()
  after=b.inventory()
  if any(not before[k]<=after[k] for k in before):raise RuntimeError('original_inventory_changed')
  if reviews!=b.reviews():raise RuntimeError('review_registry_changed')
  for k,path in ASSETS.items():
   if k=='backend':continue
   if b.sha(b.read('http://127.0.0.1:8123/local/'+path.relative_to(b.WWW).as_posix()+'?v='+TAG))!=b.sha(desired[k]):
    raise RuntimeError('served_ui_mismatch')
  print('DRIVE_PERSON_V66_DEPLOY_VERIFIED '+json.dumps({'originals':{k:len(v) for k,v in after.items()},
   'review_files_unchanged':reviews==b.reviews(),'metadata_writes':0,'backup':str(backup),
   'js_sha256':b.sha(desired['js'])}),flush=True)
 except BaseException:
  for k in reversed(changed):b.atom(ASSETS[k],*existing[k])
  b.restart()
  print('DRIVE_PERSON_V66_ROLLED_BACK',flush=True);raise
if __name__=='__main__':main()
