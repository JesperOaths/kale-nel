#!/usr/bin/env python3
"""Guarded backend-only recovery of existing native S9+ JPEG crop evidence.

No Android install, inference, video writes, review writes or UI deployment.
Dry-run stages and tests immutable, checksum-pinned Python sources. Applying
requires exact predecessor checksums, private backups and live verification.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path('/home/jespern/c720p-home-hub')
WEB=Path('/opt/homeassistant/config/www/frontyard-security-new')
INDEX=WEB/'s9-phone-events.json'
FILES={
 'catalog':('ops/c720p/s9-person-ml-v1/local-sd-catalog.py',ROOT/'bin/c720p-s9-local-sd-catalog.py'),
 'proxy':('ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py',ROOT/'bin/s9_sd_proxy_extension.py'),
 'test':('ops/c720p/s9-native-security/test-face-snapshot-integrity-v1.py',None),
 'analysis':('ops/c720p/s9-native-security/analyze-original4k-face-extraction-v1.py',None)}

def sha(data):return hashlib.sha256(data).hexdigest()
def read(url,limit):
 with urllib.request.urlopen(url,timeout=30) as r:
  if r.status!=200:raise RuntimeError('http_not_200')
  b=r.read(limit+1)
 if len(b)>limit:raise RuntimeError('bounded_read_exceeded')
 return b
def archive():
 a=json.loads(read('http://127.0.0.1:8795/new/api/saved',6000000))
 if a.get('archive_mode')!='S9-microSD-only':raise RuntimeError('wrong_archive')
 rows={r['clip_no']:r for r in a.get('events',[]) if
       isinstance(r,dict) and re.fullmatch(r'motion_[0-9]{13}[.]mp4',str(r.get('clip_no','')))}
 if not rows:raise RuntimeError('empty_original_archive')
 return rows
def images(rows):
 return {f['snapshot_name'] for r in rows.values() for f in r.get('face_candidates',[])
  if isinstance(f,dict) and isinstance(f.get('snapshot_name'),str)}
def camera():
 p=json.loads(read('http://127.0.0.1:18808/status',180000))
 if (p.get('ok') is not True or p.get('mode') not in ('watching','recording') or
     p.get('continuous_4k_ready') is not True or p.get('continuous_4k_dropped_output_frames')!=0):
  raise RuntimeError('camera_preflight_or_postflight_unhealthy')
 return p
def run(args,timeout):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('command_failed_'+Path(args[-1]).name)
 return p.stdout
def atomic(path,body,metadata):
 fd,tmp=tempfile.mkstemp(prefix='.s9-crop-integrity-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as out:out.write(body);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(metadata.st_mode))
  try:os.chown(tmp,metadata.st_uid,metadata.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--ref',required=True)
 for k in FILES:parser.add_argument('--'+k+'-sha',required=True)
 for k in ('catalog','proxy'):parser.add_argument('--'+k+'-live-sha',required=True)
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 if not re.fullmatch(r'[a-f0-9]{40}',args.ref):raise RuntimeError('immutable_ref_required')
 for k in FILES:
  if not re.fullmatch(r'[a-f0-9]{64}',getattr(args,k+'_sha')):raise RuntimeError('source_digest_required')
 for k in ('catalog','proxy'):
  if not re.fullmatch(r'[a-f0-9]{64}',getattr(args,k+'_live_sha')):raise RuntimeError('predecessor_digest_required')
 with (ROOT/'state/s9-crop-integrity-deploy.lock').open('a+') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  stage=ROOT/'build/s9-crop-integrity'/args.ref
  staged={}
  for k,(relative,dest) in FILES.items():
   b=read('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+args.ref+'/'+relative,200000)
   if sha(b)!=getattr(args,k+'_sha'):raise RuntimeError('source_checksum_mismatch_'+k)
   path=stage/relative;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   path.write_bytes(b);os.chmod(path,0o600)
   run(['/usr/bin/python3','-m','py_compile',str(path)],20)
   if dest is not None:staged[dest]=b
  run(['/usr/bin/python3',str(stage/FILES['test'][0])],40)
  before=archive();old_images=images(before);camera()
  original={}
  for k in ('catalog','proxy'):
   path=FILES[k][1]
   if path.is_symlink() or not path.is_file():raise RuntimeError('unexpected_live_target')
   b=path.read_bytes()
   if sha(b)!=getattr(args,k+'_live_sha'):raise RuntimeError('concurrent_backend_update_'+k)
   original[path]=(b,path.stat())
  print('S9_CROP_INTEGRITY_PREFLIGHT',json.dumps({'recordings':len(before),
   'indexed_images_before':len(old_images),'staged_tests_passed':True,'apply':args.apply}),flush=True)
  if not args.apply:return
  backup=ROOT/'backups/s9-crop-integrity'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
  backup.mkdir(mode=0o700,parents=True)
  if INDEX.is_symlink() or not INDEX.is_file():raise RuntimeError('unsafe_catalog_file')
  original[INDEX]=(INDEX.read_bytes(),INDEX.stat())
  for i,(path,(b,_)) in enumerate(original.items()):
   dest=backup/(str(i)+'-'+path.name);dest.write_bytes(b);os.chmod(dest,0o600)
   if sha(dest.read_bytes())!=sha(b):raise RuntimeError('backup_integrity_failed')
  if any(p.read_bytes()!=original[p][0] for p in staged):raise RuntimeError('concurrent_backend_update')
  changed=[]
  try:
   for path,b in staged.items():
    if b!=original[path][0]:atomic(path,b,original[path][1]);changed.append(path)
   run(['systemctl','--user','restart','c720p-s9-local-sd-catalog.service'],430)
   run(['systemctl','--user','restart','c720p-drive-security-archive.service'],65)
   for attempt in range(10):
    try:after=archive();break
    except Exception:
     if attempt==9:raise
     time.sleep(1)
   if not set(before)<=set(after):raise RuntimeError('original_recordings_missing')
   new_images=images(after)
   if not old_images<=new_images:raise RuntimeError('previous_images_missing')
   expected=sum(len(r.get('face_candidates',[])) for r in before.values())
   observed=sum(len([f for f in after[n].get('face_candidates',[]) if f.get('snapshot_name')]) for n in before)
   if observed<expected:raise RuntimeError('candidate_images_not_fully_recovered')
   recovered=sorted(new_images-old_images)
   sample=(recovered[::max(1,len(recovered)//12)][:12]+sorted(old_images)[:4])
   for name in sample:
    if not re.fullmatch(r'motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg',name):raise RuntimeError('invalid_sample_name')
    b=read('http://127.0.0.1:8795/new/saved/face/'+name,2200000)
    if not b.startswith(b'\xff\xd8\xff'):raise RuntimeError('recovered_image_unavailable')
   camera()
   print('S9_CROP_INTEGRITY_LIVE_VERIFIED',json.dumps({'ref':args.ref,
    'recordings':len(after),'indexed_images_before':len(old_images),'indexed_images_after':len(new_images),
    'additional_existing_images_exposed':len(recovered),'live_image_checks':len(sample),'backup':str(backup),
    'ui_files_modified':False,'camera_modified':False,'original_recordings_modified':False,
    'review_decisions_modified':False}),flush=True)
  except BaseException:
   for path in reversed(changed):atomic(path,original[path][0],original[path][1])
   atomic(INDEX,original[INDEX][0],original[INDEX][1])
   run(['systemctl','--user','restart','c720p-drive-security-archive.service'],65)
   raise
if __name__=='__main__':main()
