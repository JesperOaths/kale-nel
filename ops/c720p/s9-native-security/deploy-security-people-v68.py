#!/usr/bin/env python3
"""Guarded V68 people/filing rollout. No camera APK, media, or review writes."""
import argparse
import difflib
import importlib.util
import json
import re
import stat
import datetime as dt
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('v66',ROOT/'deploy-security-drive-person-v66.py')
v66=importlib.util.module_from_spec(spec);spec.loader.exec_module(v66)
b=v66.b
TAG='security-people-multilink-v68-20261019'
PIN='962b15b04cf3f130e568ba4d014ce5c06533b80f'
ASSETS=v66.ASSETS

def patch_js(live,old,new):
 # Applying only changed hunks avoids discarding unrelated deployed OSNet,
 # telemetry, health, presence, or analytics code not present in source.
 previous=old.splitlines(keepends=True)
 incoming=new.splitlines(keepends=True)
 result=live
 edits=0
 for kind,i1,i2,j1,j2 in difflib.SequenceMatcher(None,previous,incoming,autojunk=False).get_opcodes():
  if kind=='equal':continue
  before=''.join(previous[i1:i2])
  after=''.join(incoming[j1:j2])
  if before:
   if result.count(before)!=1:raise RuntimeError('conflicting_live_change_'+str(i1))
   result=result.replace(before,after,1)
  else:
   # Insert at a unique source-context boundary; unknown/current edits fail.
   before_ctx=''.join(previous[max(0,i1-3):i1])
   after_ctx=''.join(previous[i1:i1+3])
   anchor=before_ctx+after_ctx
   if not anchor or result.count(anchor)!=1:raise RuntimeError('ambiguous_insert_'+str(i1))
   result=result.replace(anchor,before_ctx+after+after_ctx,1)
  edits+=1
 if not edits or 'addApprovalPerson' not in result or 'function assignedFolders' not in result:
  raise RuntimeError('missing_v68_modifications')
 return result.encode()

def patch_html(raw):
 t=raw.decode()
 if 'id="approvalExtraPeople"' in t and 'id="approvalAddPerson"' in t:return raw
 candidates=list(re.finditer(r'<label id="newLabel">[^<]*<input id="approvalLabel"[^>]*>\s*</label>',t))
 if len(candidates)!=1:raise RuntimeError('unrecognized_people_form_markup')
 slot=candidates[0]
 controls=('\n<div id="approvalExtraPeople" aria-live="polite"></div>'
  '\n<button id="approvalAddPerson" class="secondary" type="button">+ Add another person</button>')
 t=t[:slot.end()]+controls+t[slot.end():]
 css=('\n#approvalExtraPeople{display:grid;gap:8px;margin:8px 0}'
  '\n.additional-person-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
  '\n.additional-person-row select{flex:1;min-width:140px}'
  '\n#approvalAddPerson{display:block;width:100%;margin-top:9px}'
  '\n')
 if t.count('</style>')!=1:raise RuntimeError('people_style_missing')
 t=t.replace('</style>',css+'</style>',1)
 return t.encode()

def guard_originals(before,after):
 for kind in before:
  if not before[kind].issubset(after[kind]):raise RuntimeError('original_missing_'+kind)

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--ref',required=True)
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 if not re.fullmatch(r'[0-9a-f]{40}',args.ref):raise RuntimeError('immutable_source_sha_required')
 current={}
 for name,path in ASSETS.items():
  if not path.is_file() or path.is_symlink():raise RuntimeError('unexpected_live_path_'+name)
  current[name]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
 if b.sha(current['js'][0])!=v66.ALREADY_JS:
  raise RuntimeError('concurrent_security_ui_update')
 old=b.src(PIN,b.PREFIX+'security-people-v45.js')
 new=b.src(args.ref,b.PREFIX+'security-people-v45.js')
 old_backend=b.src(PIN,'ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py')
 new_backend=b.src(args.ref,'ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py')
 if b.sha(current['backend'][0])!=b.sha(old_backend.encode()):
  raise RuntimeError('concurrent_manual_links_change')
 prior=b.inventory()
 decisions=b.reviews()
 desired={
   'js':patch_js(current['js'][0].decode(),old,new),
   'backend':new_backend.encode(),
   'people':patch_html(current['people'][0]),
 }
 compile(new_backend,'s9_manual_recording_links.py','exec')
 b.check_js(desired['js'])
 b.TAG=TAG
 for name,asset in [('people','security-people-v45.js'),('hub','security-people-v50.html'),('entry','security-hub-v30.js')]:
  if name=='people':desired[name]=b.cache(desired[name].decode(),asset)
  else:desired[name]=b.cache(current[name][0].decode(),asset)
 shell=current['shell'][0].decode()
 for asset in ('security-people-v50.html','security-hub-v30.js','security-hub-v30.html'):
  if (asset+'?v=') in shell:
   shell=b.cache(shell,asset).decode()
 desired['shell']=shell.encode()
 assert all(k in desired for k in ASSETS)
 print('PEOPLE_V68_PREFLIGHT '+json.dumps({'apply':args.apply,
  'sources':{k:len(v) for k,v in prior.items()},
  'js_sha256':b.sha(desired['js']),'review_files_unchanged':decisions==b.reviews()}),flush=True)
 if not args.apply:return
 backup=b.BASE/'backups/security-people-v68'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for name,(raw,_) in current.items():b.atom(backup/(name+'-previous'),raw,0o600)
 changed=[]
 try:
  for name,path in ASSETS.items():
   if path.read_bytes()!=current[name][0]:raise RuntimeError('concurrent_change_'+name)
   b.atom(path,desired[name],current[name][1]);changed.append(name)
  b.restart()
  after=b.inventory();guard_originals(prior,after)
  if decisions!=b.reviews():raise RuntimeError('review_state_changed')
  for name,path in ASSETS.items():
   if name=='backend':continue
   url='http://127.0.0.1:8123/local/'+path.relative_to(b.WWW).as_posix()+'?v='+TAG
   if b.sha(b.read(url))!=b.sha(desired[name]):raise RuntimeError('served_asset_mismatch_'+name)
  print('PEOPLE_V68_DEPLOY_VERIFIED '+json.dumps({'sources':{k:len(v) for k,v in after.items()},
   'review_files_unchanged':True,'media_modified':False,'camera_modified':False,
   'backup':str(backup),'js_sha256':b.sha(desired['js'])}),flush=True)
 except BaseException:
  for name in reversed(changed):b.atom(ASSETS[name],*current[name])
  b.restart();print('PEOPLE_V68_ROLLED_BACK',flush=True);raise
if __name__=='__main__':main()
