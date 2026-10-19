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
  if previous==replacement:continue
  try:live_block=b.block(result,start,end)
  except ValueError as error:
   raise RuntimeError('unrecognized_live_region_'+start.split('(')[0].strip()[:40]) from error
  if live_block==replacement:continue
  if live_block==previous:
   result=b.one(result,previous,replacement)
   continue
  if start=='function chosenPortrait(f){':
   # V70's deployed region contains one extra preserved source line. Apply
   # only the three verified portrait policy statements; never replace the
   # entire function and discard that independent live addition.
   old_find="return state.faceList.find(x=>x.clip===saved.clip&&x.face.snapshot_name===saved.name&&credibleFaceCrop(x))||null;"
   new_find=("return state.faceList.find(x=>x.clip===saved.clip&&x.face.snapshot_name===saved.name&&\n"
     "  x.face.snapshot_on_s9!==false)||null;")
   old_guard=("if(!id||!faceName.test(name)||!credibleFaceCrop(face)||\n"
     "     !state.doc?.items?.some(x=>x.clip===face.clip&&x.decision==='approved')){")
   # The protected V70 live build uses the already verified, source-qualified
   # approved-folder helper instead of the stale repository v40-only predicate.
   # This exact alternate guard was inspected read-only in management job #11860.
   live_guard=("if(!id||!faceName.test(name)||!credibleFaceCrop(face)||\n"
     "     !folderApprovedSDClips(id).has(face.clip)){")
   new_guard=("if(!id||!faceName.test(name)||face?.face?.snapshot_on_s9===false||\n"
     "     !assignedRecordingKeys(id).has('sd:'+face.clip)){")
   old_notice="notification('Person portrait selected on this browser. Review decisions were not changed.');"
   new_notice="notification('Manually selected person portrait on this browser. The selected crop was not automatically verified.');"
   partial=live_block
   for before,after in ((old_find,new_find),(old_guard,new_guard),(old_notice,new_notice)):
    if after in partial:continue
    if before==old_guard and partial.count(before)==0 and partial.count(live_guard)==1:
     before=live_guard
    if partial.count(before)!=1:raise RuntimeError('unrecognized_live_portrait_statement')
    partial=partial.replace(before,after,1)
   guard="if(!assignedRecordingKeys(id).has('sd:'+saved.clip))return null;"
   if guard not in partial:
    if partial.count(new_find)!=1:raise RuntimeError('portrait_guard_insert_ambiguous')
    partial=partial.replace(new_find,guard+"\n "+new_find,1)
   if partial==live_block:raise RuntimeError('unchanged_live_portrait_policy')
   result=b.one(result,live_block,partial)
   continue
  # Fail safely, with source-only fingerprints instead of publishing any
  # identity, recording, or personal-review data.
  print('FACE_V71_BOUNDARY_DRIFT '+json.dumps({
   'start':start,'old_sha256':b.sha(previous.encode()),
   'live_sha256':b.sha(live_block.encode()),
   'new_sha256':b.sha(replacement.encode()),
   'old_lines':len(previous.splitlines()),
   'live_lines':len(live_block.splitlines()),
   'new_lines':len(replacement.splitlines())}),flush=True)
  raise RuntimeError('concurrent_people_region_'+start.split('(')[0].strip()[:40])
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
