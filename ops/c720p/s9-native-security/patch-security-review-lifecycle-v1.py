#!/usr/bin/env python3
"""Pure source transforms for final review decisions and active-tab polling.

Stages separate assets only; never deploys, restarts or calls a camera/review API.
Exact anchors and per-feature markers preserve concurrent unrelated UI changes.
"""
import argparse
import hashlib
import json
from pathlib import Path

VERSION='security_review_lifecycle_v1'
FILES=('security-people-v45.js','security-review-v8.html','s9-night-visibility-v1.js')
OUTFIT_MARKER='// SECURITY_OUTFIT_REVIEW_FINALITY_V1'
OUTFIT_HELPER='''// SECURITY_OUTFIT_REVIEW_FINALITY_V1
function outfitReviewEligible(clip){
 const item={source:'sd',name:clip,clip},key=assignmentKey(item);
 const explicit=state.extraLinks?.items?.[key];
 if(explicit!==undefined&&explicit!==null){
  // Only an explicit empty inbox state reopens a completed manual decision.
  if(typeof explicit!=='object'||Array.isArray(explicit)||explicit.review_status!=='inbox')return false;
  if(explicit.folder!=null||!(explicit.folders==null||Array.isArray(explicit.folders)&&explicit.folders.length===0))return false;
 }
 return !assignedFolders(item).length&&reviewDecision(item)==='inbox';
}
'''
OUTFIT_ANCHOR=' // S9_REVIEWED_OSNET_HSV_SUGGESTIONS_V1. Suggestion evidence, not an ID.'
OUTFIT_OLD="   if(assignedFolder({source:'sd',name:clip,clip}))continue;"
OUTFIT_NEW="   if(!outfitReviewEligible(clip))continue;"
OUTFIT_RENDER_OLD=' const matches=state.clothingMatches||[];'
OUTFIT_RENDER_NEW=' const matches=(state.clothingMatches||[]).filter(match=>outfitReviewEligible(match.clip));'
REVIEW_MARKER='// SECURITY_REVIEW_ACTIVE_TAB_V1'
REVIEW_OLD="""document.addEventListener('visibilitychange',()=>{if(document.hidden)state.activeVideo?.pause();else if(!state.all.length)refresh()});
window.addEventListener('pagehide',playbackStop);
refresh();setInterval(()=>{if(!document.hidden)refresh()},60000);"""
REVIEW_NEW="""// SECURITY_REVIEW_ACTIVE_TAB_V1
function reviewTabVisible(){return !document.hidden&&window.SecurityTabActive!==false}
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.origin!==location.origin)return;
 if(event.data?.kind==='security-tab-refresh-v37'){refresh();return}
 if(event.data?.kind!=='security-tab-visibility-v37')return;
 window.SecurityTabActive=event.data.active===true;
 if(!reviewTabVisible())playbackStop();
 else if(!state.all.length)refresh();
});
if(window.parent!==window){
 window.SecurityTabActive=false;
 window.parent.postMessage({kind:'security-tab-ready-v37'},location.origin);
}
document.addEventListener('visibilitychange',()=>{if(!reviewTabVisible())playbackStop();else if(!state.all.length)refresh()});
window.addEventListener('pagehide',playbackStop);
refresh();setInterval(()=>{if(reviewTabVisible())refresh()},60000);"""
NIGHT_MARKER='// SECURITY_NIGHT_VISIBLE_PANE_V1'
NIGHT_OLD='    if(ended||inflight||document.hidden)return;'
NIGHT_NEW='    '+NIGHT_MARKER+'\n    if(ended||inflight||document.hidden||section.hidden)return;'

def once(text,old,new,label):
 if text.count(old)!=1:raise ValueError('unexpected_'+label+'_anchor')
 return text.replace(old,new,1)

def patch_people(text):
 model='async function addReviewedOsnetMatches(' in text
 expected=2 if model else 1
 anchor=OUTFIT_ANCHOR if model else 'async function searchClothingMatches(force=false){'
 if not model and 'S9_REVIEWED_OSNET_HSV_SUGGESTIONS_V1' in text:
  raise ValueError('partial_existing_osnet_helper')
 if OUTFIT_MARKER in text:
  if (text.count(OUTFIT_HELPER)!=1 or text.count(OUTFIT_NEW)!=expected or OUTFIT_OLD in text
      or text.count(OUTFIT_RENDER_NEW)!=1 or OUTFIT_RENDER_OLD in text):
   raise ValueError('partial_outfit_finality_patch')
  return text
 if text.count(OUTFIT_OLD)!=expected:raise ValueError('unexpected_outfit_candidate_filters')
 text=once(text,anchor,OUTFIT_HELPER+'\n'+anchor,'outfit_helper')
 return once(text.replace(OUTFIT_OLD,OUTFIT_NEW),OUTFIT_RENDER_OLD,OUTFIT_RENDER_NEW,'outfit_cached_matches')

def patch_review(text):
 if REVIEW_MARKER in text:
  if text.count(REVIEW_NEW)!=1 or REVIEW_OLD in text:raise ValueError('partial_review_visibility_patch')
  return text
 return once(text,REVIEW_OLD,REVIEW_NEW,'review_visibility')

def patch_night(text):
 if "const section=document.getElementById('panel-live');" not in text:
  raise ValueError('unexpected_night_live_pane')
 if NIGHT_MARKER in text:
  if text.count(NIGHT_NEW)!=1 or NIGHT_OLD in text:raise ValueError('partial_night_visibility_patch')
  return text
 return once(text,NIGHT_OLD,NIGHT_NEW,'night_visibility')

PATCHERS=dict(zip(FILES,(patch_people,patch_review,patch_night)))

def patch_asset(name,text):
 newline='\r\n' if '\r\n' in text else '\n'
 normalized=text.replace('\r\n','\n')
 result=PATCHERS[name](normalized)
 if PATCHERS[name](result)!=result:raise ValueError('non_idempotent_'+name)
 return result.replace('\n',newline)

def stage(source_root,output_dir=None):
 source_root=Path(source_root).resolve(strict=True)
 if output_dir is not None:
  output_dir=Path(output_dir).resolve()
  if output_dir==source_root or output_dir in source_root.parents or source_root in output_dir.parents:
   raise ValueError('output_must_be_separate_from_source')
 prepared={};manifest={'version':VERSION,'files':{}}
 for name in FILES:
  source=source_root/name
  if source.is_symlink() or not source.is_file():raise ValueError('invalid_source_'+name)
  before=source.read_bytes();after=patch_asset(name,before.decode('utf-8')).encode('utf-8')
  prepared[name]=after
  manifest['files'][name]={'before_sha256':hashlib.sha256(before).hexdigest(),
   'after_sha256':hashlib.sha256(after).hexdigest(),'changed':before!=after}
 if output_dir is not None:
  if any((output_dir/name).exists() for name in (*FILES,'review-lifecycle-manifest.json')):
   raise ValueError('stage_output_already_exists')
  output_dir.mkdir(parents=True,exist_ok=True)
  for name,content in prepared.items():
   with (output_dir/name).open('xb') as target:target.write(content)
  with (output_dir/'review-lifecycle-manifest.json').open('x',encoding='utf-8') as target:
   json.dump(manifest,target,indent=2)
 return manifest

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source-root',type=Path,required=True)
 parser.add_argument('--output-dir',type=Path)
 args=parser.parse_args()
 print(json.dumps(stage(args.source_root,args.output_dir),indent=2))

if __name__=='__main__':main()
