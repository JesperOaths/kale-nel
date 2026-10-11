#!/usr/bin/env python3
"""Guarded UI-only deployment: S9 Faces & Appearances Home Assistant tab.

No APK, ADB, camera service, archive modification or video transcoding.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT=Path('/opt/homeassistant/config/www')
SECURITY=ROOT/'c720p-surveillance.html'
GALLERY=ROOT/'frontyard-security-new/face-appearances.html'
BACKUP=Path('/home/jespern/c720p-home-hub/backups/security-faces-appearances')

def archive_health():
 with urllib.request.urlopen('http://127.0.0.1:8795/new/api/saved',timeout=20) as response:
  payload=json.load(response)
 if payload.get('archive_mode')!='S9-microSD-only' or not isinstance(payload.get('events'),list):
  raise RuntimeError('S9_microSD_archive_not_healthy')
 return len(payload['events'])

def load_patch(path):
 spec=importlib.util.spec_from_file_location('faces_nav',str(path))
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod.patch

def safe_write(path,source,mode):
 temp=path.with_name(path.name+'.faces-stage')
 temp.write_text(source)
 os.chmod(temp,mode)
 os.replace(temp,path)

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--stage',required=True,type=Path)
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 stage=args.stage.resolve()
 patch_path=stage/'patch-security-faces-tab.py'
 template=stage/'face-appearances.html.txt'
 checks=stage/'test-security-faces-tab.py'
 if not all(p.is_file() for p in (patch_path,template,checks,SECURITY)):
  raise RuntimeError('missing_authenticated_security_or_stage')
 p=subprocess.run([sys.executable,str(checks)],capture_output=True,text=True,timeout=30)
 print('FACES_SOURCE_TESTS',p.returncode,p.stderr[-550:],flush=True)
 if p.returncode:raise RuntimeError('source_tests_failed')
 old_html=SECURITY.read_text()
 new_gallery=template.read_text()
 if 'C720PSecureRelay' not in new_gallery or '/new/saved/face/' not in new_gallery or '/new/saved/clip/' not in new_gallery:
  raise RuntimeError('gallery_signed_relay_contract_missing')
 if "GEJAST_PAGE_VERSION='v817'" not in new_gallery or 'v817 - Made by Bruis' not in new_gallery:
  raise RuntimeError('gallery_version_identity_missing')
 nav_patch=load_patch(patch_path)
 new_html=nav_patch(old_html)
 if nav_patch(new_html)!=new_html:raise RuntimeError('non_idempotent_nav')
 if not all(x in new_html for x in ('data-tab="saved"','data-tab="camera"','data-tab="live"','data-tab="faces"','s9FacesGalleryFrame')):
  raise RuntimeError('existing_security_navigation_changed')
 before=archive_health()
 if not args.apply:
  print('S9_FACES_DRY_RUN_OK',json.dumps({'saved_events':before,'changes_nav':new_html!=old_html,'gallery_bytes':len(new_gallery)}),flush=True)
  return
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 target=BACKUP/stamp
 target.mkdir(parents=True,exist_ok=False)
 originals={}
 for current in (SECURITY,GALLERY):
  if current.is_file():
   dest=target/('security.html' if current==SECURITY else 'face-appearances.html')
   shutil.copy2(current,dest)
   os.chmod(dest,0o600)
   originals[current]=dest
  else:originals[current]=None
 changes=[]
 try:
  if not GALLERY.is_file() or GALLERY.read_text()!=new_gallery:
   safe_write(GALLERY,new_gallery,0o644)
   changes.append(GALLERY)
  if old_html!=new_html:
   safe_write(SECURITY,new_html,SECURITY.stat().st_mode & 0o777)
   changes.append(SECURITY)
  final=SECURITY.read_text()
  if nav_patch(final)!=final or final.count('id="panel-faces"')!=1:
   raise RuntimeError('live_nav_invalid')
  if hashlib.sha256(GALLERY.read_bytes()).digest()!=hashlib.sha256(template.read_bytes()).digest():
   raise RuntimeError('gallery_checksum_mismatch')
  after=archive_health()
  if after<before:raise RuntimeError('archive_video_count_fell')
  print('S9_FACES_GALLERY_DEPLOY_OK',json.dumps({'backup':str(target),
   'archive_events':after,'gallery_bytes':GALLERY.stat().st_size,
   'tab_visible_in_HA_markup':True,'camera_restarted':False,
   'apk_modified':False,'recordings_modified':False}),flush=True)
 except BaseException:
  for current in reversed(changes):
   previous=originals[current]
   if previous:
    restore=current.with_name(current.name+'.faces-restore')
    shutil.copy2(previous,restore);os.replace(restore,current)
   elif current.exists():current.unlink()
  print('S9_FACES_DEPLOY_ROLLBACK',str(target),flush=True)
  raise
if __name__=='__main__':main()
