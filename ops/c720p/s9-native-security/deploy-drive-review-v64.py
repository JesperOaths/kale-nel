#!/usr/bin/env python3
"""Patch the actual V63 review UI without replacing newer unrelated features."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.request

BASE=Path('/opt/homeassistant/config/www')
ROOT=BASE/'frontyard-security-new'
HOME=Path('/home/jespern/c720p-home-hub')
ASSETS={'js':ROOT/'security-people-v45.js','people':ROOT/'security-people-v50.html',
 'hub':ROOT/'security-hub-v30.js','entry':ROOT/'security-hub-v30.html','shell':BASE/'c720p-surveillance.html'}
BEFORE='949a5d90748c042375fe0634bcb7c16201459c60'
LIVE_JS='0c71ecb4838d0deeeff81d51479873091f37cb0b5145196aff9b3d7188b92ff4'
OLD_TAG='security-automatic-person-v63-20261019'
NEW_TAG='security-drive-review-v64-20261019'
SRC='ops/c720p/s9-native-security/'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def get(url,bound=250000):
 with urllib.request.urlopen(url,timeout=25) as r:raw=r.read(bound+1)
 if not 40<len(raw)<=bound:raise RuntimeError('invalid_source_size')
 return raw
def source(ref,name):
 return get('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+ref+'/'+SRC+name).decode()
def one(text,old,new):
 if old==new or not old or text.count(old)!=1:raise RuntimeError('unknown_live_review_anchor')
 return text.replace(old,new,1)
def block(text,start,end):
 a=text.index(start);b=text.index(end,a)
 return text[a:b]
def patch_js(live,old,new):
 text=live.decode()
 for start,end in (
  ('function assignmentKey(item){','function makeArchiveRows(){'),
  ('async function loadView(){','async function fetchFaces(){'),
  ('function renderReview(){','function renderPeople(){')):
  text=one(text,block(old,start,end),block(new,start,end))
 for before,after in (
  ('offset:0,limit:100,recheckOnly:false','offset:0,limit:100,reviewSource:\'all\',recheckOnly:false'),
  ('  if(state.doc)refreshArchiveReviewSources(state.doc.folders);',
   '  if(state.doc&&!state.assignedReady&&state.archiveToken===0)\n   refreshArchiveReviewSources(state.doc.folders);'),
  (" $('queueCount').textContent=String(num(state.doc?.inbox_clips));\n const queue=num(state.doc?.inbox_clips);",
   " const queue=state.assignedReady&&state.extraLinks?\n  unassignedArchiveRows().length:num(state.doc?.inbox_clips);\n $('queueCount').textContent=String(queue);"),
  (' const waiting=num(state.doc?.inbox_clips);',
   ' const waiting=state.assignedReady&&state.extraLinks?\n  unassignedArchiveRows().length:num(state.doc?.inbox_clips);'),
  ("$('peopleReviewNow').addEventListener('click',()=>openReview('inbox'));",
   "$('peopleReviewNow').addEventListener('click',()=>openReview('all'));")
 ):
  if before not in old or after not in new:raise RuntimeError('patch_not_in_reviewed_source')
  text=one(text,before,after)
 start="$('reviewMode').addEventListener"
 end="$('pageSize').addEventListener"
 text=one(text,block(old,start,end),block(new,start,end))
 for token in ('fetchAutomatic','approvedFolderContext','faceFetchError','manualLink(',"'drive'",'reviewSource'):
  if token not in text:raise RuntimeError('lost_existing_feature')
 return text.encode()
def atom(path,raw,mode):
 fd,tmp=tempfile.mkstemp(prefix='.drive-review-v64-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def inventory():
 out={}
 for name,path in [('sd','/new/api/saved'),('drive','/new/api/drive-saved')]:
  d=json.loads(get('http://127.0.0.1:8795'+path,6000000))
  if d.get('ok') is not True or not isinstance(d.get('events'),list):raise RuntimeError('archive_unavailable')
  keys={str(r.get('clip_no') if name=='sd' else r.get('remote_name')) for r in d['events']}
  if not keys or len(keys)!=len(d['events']):raise RuntimeError('archive_incomplete')
  out[name]=keys
 return out
def reviews():
 return {n:sha((HOME/'state'/n).read_bytes()) if (HOME/'state'/n).is_file() else None for n in
  ('s9-manual-recording-links-v1.json','s9-manual-recording-links-v1.audit.jsonl',
   's9-auto-person-rejections-v1.json','s9-auto-person-rejections-v1.audit.jsonl')}
def main():
 p=argparse.ArgumentParser();p.add_argument('--ref',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 if not re.fullmatch('[a-f0-9]{40}',a.ref):raise RuntimeError('immutable_source_ref_required')
 existing={}
 for key,path in ASSETS.items():
  if not path.is_file() or path.is_symlink():raise RuntimeError('unexpected_asset')
  existing[key]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
 if sha(existing['js'][0])!=LIVE_JS:raise RuntimeError('concurrent_people_ui_update')
 before=inventory();decisions=reviews()
 fresh=patch_js(existing['js'][0],source(BEFORE,'security-people-v45.js'),source(a.ref,'security-people-v45.js'))
 html=existing['people'][0].decode()
 new_html=source(a.ref,'security-people-v45.html')
 start='<label>Source<select id="reviewSource">'
 control=new_html[new_html.index(start):new_html.index('\n<label>Per page',new_html.index(start))]+'\n'
 html=one(html,'<label>Per page<select id="pageSize">',control+'<label>Per page<select id="pageSize">')
 desired={'js':fresh,'people':html.encode()}
 for key in ('people','hub','entry','shell'):
  old=desired.get(key,existing[key][0])
  if OLD_TAG.encode() not in old:raise RuntimeError('unknown_v63_route')
  desired[key]=old.replace(OLD_TAG.encode(),NEW_TAG.encode())
 print('DRIVE_REVIEW_V64_PREFLIGHT '+json.dumps({'sd':len(before['sd']),'drive':len(before['drive']),
  'js_sha256':sha(fresh),'apply':a.apply}),flush=True)
 if not a.apply:return
 backup=HOME/'backups/security-drive-review-v64'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,(raw,mode) in existing.items():atom(backup/(key+'-previous'),raw,0o600)
 changed=[]
 try:
  for key,path in ASSETS.items():
   raw,mode=existing[key]
   if path.read_bytes()!=raw:raise RuntimeError('concurrent_asset_update')
   atom(path,desired[key],mode);changed.append(key)
  after=inventory()
  if any(not before[k]<=after[k] for k in before) or decisions!=reviews():raise RuntimeError('original_or_review_changed')
  for key,path in ASSETS.items():
   body=get('http://127.0.0.1:8123/local/'+path.relative_to(BASE).as_posix()+'?v='+NEW_TAG,1000000)
   if sha(body)!=sha(desired[key]):raise RuntimeError('served_asset_mismatch')
  print('DRIVE_REVIEW_V64_DEPLOY_VERIFIED '+json.dumps({'sd':len(after['sd']),'drive':len(after['drive']),
   'reviews_unchanged':True,'camera_changed':False,'backup':str(backup),'js_sha256':sha(fresh)}),flush=True)
 except BaseException:
  for key in reversed(changed):atom(ASSETS[key],*existing[key])
  print('DRIVE_REVIEW_V64_ROLLED_BACK',flush=True)
  raise
if __name__=='__main__':main()
