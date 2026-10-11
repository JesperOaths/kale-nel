#!/usr/bin/env python3
"""Retain S9+ 36-frame face review provenance in C720P's safe local clip catalog.

Changes metadata allowlisting only. Original videos, embeddings, face photos,
camera process and signed playback authorization are unaffected.
"""
import argparse
import datetime
import importlib.util
import os
from pathlib import Path
import py_compile
import shutil
import stat
import subprocess

CAT=Path('/home/jespern/c720p-home-hub/bin/c720p-s9-local-sd-catalog.py')
BACK=Path('/home/jespern/c720p-home-hub/backups/s9-face-scan-metadata')
OLD_DEFAULT='"face_review_sampled_frames":None,"face_snapshots_saved":0,"face_candidates":[]}'
NEW_DEFAULT='"face_review_sampled_frames":None,"face_snapshots_saved":0,"face_candidates":[],\n         "face_deep_review_version":None}'
OLD_RANGE='if type(n) is int and 0<=n<=12:result["face_review_sampled_frames"]=n'
NEW_RANGE=('if type(n) is int and 0<=n<=48:result["face_review_sampled_frames"]=n\n'
 ' if m.get("face_deep_review_version")=="s9_onphone_36_samples_v1" and n==36:\n'
 '  result["face_deep_review_version"]="s9_onphone_36_samples_v1"')

def patch(text):
 if NEW_RANGE in text and NEW_DEFAULT in text:return text
 if text.count(OLD_RANGE)!=1 or text.count(OLD_DEFAULT)!=1:
  raise ValueError('unexpected_local_catalog_face_contract')
 return text.replace(OLD_DEFAULT,NEW_DEFAULT,1).replace(OLD_RANGE,NEW_RANGE,1)

def exercise(path):
 spec=importlib.util.spec_from_file_location('s9_live_catalog_deep',str(path))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 meta={'face_review_version':'s9_face_review_v1',
  'face_review_status':'no_frontal_face_in_samples',
  'face_review_sampled_frames':36,'face_deep_review_version':'s9_onphone_36_samples_v1',
  'face_candidates':[],'embedding':[.1]*128}
 safe=module.safe_face_review_metadata(meta)
 assert safe['face_review_sampled_frames']==36
 assert safe['face_deep_review_version']=='s9_onphone_36_samples_v1'
 assert 'embedding' not in str(safe)
 meta['face_review_sampled_frames']=49
 safe=module.safe_face_review_metadata(meta)
 assert safe['face_review_sampled_frames'] is None
 assert safe['face_deep_review_version'] is None

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--apply',action='store_true')
 ap.add_argument('--file',type=Path,default=CAT)
 a=ap.parse_args()
 if not a.file.is_file():raise RuntimeError('catalog_missing')
 before=a.file.read_text()
 after=patch(before)
 if patch(after)!=after:raise RuntimeError('non_idempotent')
 temp=a.file.with_name(a.file.name+'.deep-review-stage.py')
 try:
  temp.write_text(after)
  os.chmod(temp,stat.S_IMODE(a.file.stat().st_mode))
  py_compile.compile(str(temp),doraise=True)
  exercise(temp)
  if not a.apply:
   print('S9_FACE_CATALOG_DRYRUN_OK',{'would_change':before!=after})
   return
  if before==after:
   print('S9_FACE_CATALOG_ALREADY_APPLIED')
   return
  BACK.mkdir(parents=True,exist_ok=True)
  backup=BACK/('catalog-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.py')
  shutil.copy2(a.file,backup)
  os.chmod(backup,0o600)
  os.replace(temp,a.file)
  print('S9_FACE_CATALOG_METADATA_DEPLOY_OK',{'backup':str(backup),'face_scan_evidence_allowlisted':True,'original_videos_modified':False})
 finally:
  if temp.exists():temp.unlink()

if __name__=='__main__':main()
