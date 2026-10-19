#!/usr/bin/env python3
"""Deploy manual-review face crop gallery without touching camera, originals or review data."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import stat

HERE=Path(__file__).resolve().parent
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module
v70=load('v70',HERE/'deploy-security-group-v70.py')
v66=v70.v66
b=v70.b
TAG='security-review-face-choices-v71-20261019'
BEFORE='6f6211a2c79da5a31c960a3e6fed147e7d36b19e'
LIVE_SHA='25c41501a5f870475530adfbfd671aaa601a1883156b5a0863519fdce86f30c1'
ASSETS={k:v66.ASSETS[k] for k in ('js','people','hub','entry','shell')}

def patch_js(live,old,new):
 result=live
 # Replace four exact source-bounded regions. None may touch the independent
 # OSNet matcher, automatic-person producer, or recorder support.
 for start,end in (
  ('function folderApprovedSDClips(id){','function assignedRecordingKeys(folder){'),
  ('function chosenPortrait(f){','function approvedPreviewClip(preview){'),
  (" badge(media,item.source==='drive'"," if(item.decision==='approved'){"),
  (' const faceMatches=state.faceList.filter('," paginate($('folderPage')"),
 ):
  previous=b.block(old,start,end)
  replacement=b.block(new,start,end)
  if previous!=replacement:result=b.one(result,previous,replacement)
 for marker in ('Unverified crop','Use as portrait','function folderApprovedSDClips',
     'function fetchAutomatic','function searchClothingMatches','assign_many'):
  if marker not in result:raise RuntimeError('security_feature_missing_'+marker)
 return result.encode()

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--ref',required=True);p.add_argument('--apply',action='store_true')
 args=p.parse_args()
 if not re.fullmatch(r'[a-f0-9]{40}',args.ref):raise RuntimeError('pinned_source_required')
 old=b.src(BEFORE,b.PREFIX+'security-people-v45.js')
 new=b.src(args.ref,b.PREFIX+'security-people-v45.js')
 current={}
 for key,path in ASSETS.items():
  if not path.is_file() or path.is_symlink():raise RuntimeError('unsafe_live_asset_'+key)
  current[key]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
 if b.sha(current['js'][0])!=LIVE_SHA:raise RuntimeError('concurrent_people_js_update')
 expected=b.src(args.ref,'ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py')
 backend=v66.ASSETS['backend']
 if backend.is_symlink() or not backend.is_file() or b.sha(backend.read_bytes())!=b.sha(expected.encode()):
  raise RuntimeError('concurrent_manual_links_backend_update')
 before=b.inventory();decisions=b.reviews()
 desired={'js':patch_js(current['js'][0].decode(),old,new)}
 for feature in ('function folderApprovedSDClips','Unverified crop','Use as portrait',
                 'function searchClothingMatches','function fetchAutomatic','assign_many'):
  if feature.encode() not in desired['js']:raise RuntimeError('lost_security_feature_'+feature)
 b.check_js(desired['js'])
 b.TAG=TAG
 for key,asset in (('people','security-people-v45.js'),
                   ('hub','security-people-v50.html'),
                   ('entry','security-hub-v30.js')):
  desired[key]=b.cache(current[key][0].decode(),asset)
 shell=current['shell'][0].decode()
 for asset in ('security-people-v50.html','security-hub-v30.js','security-hub-v30.html'):
  if (asset+'?v=') in shell:
   shell=b.cache(shell,asset).decode()
 desired['shell']=shell.encode()
 if any(k not in desired for k in ASSETS):raise RuntimeError('missing_asset')
 print('PERSON_FACE_V71_PREFLIGHT '+json.dumps({'apply':args.apply,
  'originals':{k:len(v) for k,v in before.items()},
  'review_unchanged':decisions==b.reviews(),'sha256':b.sha(desired['js'])}),flush=True)
 if not args.apply:return
 backup=b.BASE/'backups/security-person-face-v71'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,(raw,_) in current.items():b.atom(backup/(key+'-previous'),raw,0o600)
 changed=[]
 try:
  for key,path in ASSETS.items():
   if path.read_bytes()!=current[key][0]:raise RuntimeError('concurrent_asset_mutation_'+key)
   b.atom(path,desired[key],current[key][1]);changed.append(key)
  # All routes and original buffers preserved, no camera restart or APK update.
  for key,path in ASSETS.items():
   actual=b.read('http://127.0.0.1:8123/local/'+path.relative_to(b.WWW).as_posix()+'?v='+TAG)
   if b.sha(actual)!=b.sha(desired[key]):raise RuntimeError('served_asset_mismatch_'+key)
  after=b.inventory()
  for key in before:
   if not before[key].issubset(after[key]):raise RuntimeError('original_inventory_regression_'+key)
  if decisions!=b.reviews():raise RuntimeError('review_decisions_changed')
  if backend.read_bytes()!=expected.encode():raise RuntimeError('backend_changed')
  print('PERSON_FACE_V71_DEPLOY_VERIFIED '+json.dumps({
   'originals':{k:len(v) for k,v in after.items()},
   'review_unchanged':True,'backend_modified':False,
   'camera_modified':False,'media_modified':False,
   'sha256':b.sha(desired['js']),'backup':str(backup)}),flush=True)
 except BaseException:
  for key in reversed(changed):b.atom(ASSETS[key],*current[key])
  print('PERSON_FACE_V71_ROLLED_BACK',flush=True)
  raise
if __name__=='__main__':main()
