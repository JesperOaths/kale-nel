#!/usr/bin/env python3
"""Guarded hub adapters for an already verified on-phone archive API.

No original videos, phone settings, manual decisions or UI assets are targets.
The phone APK has its own exact-binary rollback and capture acceptance gate.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT=Path('/home/jespern/c720p-home-hub')
WEB=Path('/opt/homeassistant/config/www/frontyard-security-new')
FILES={
 'ops/c720p/security-runtime/phone_archive_catalog_v1.py':('phone_archive_catalog_v1.py',None),
 'ops/c720p/security-runtime/s9_hub_playback.py':('s9_hub_playback.py','e36c0f92976867400d4752939b82ada3cde9b7958f2626cd8216a289ed76db6c'),
 'ops/c720p/s9-person-ml-v1/local-sd-catalog.py':('c720p-s9-local-sd-catalog.py','db37d7b4447fbf6ff3a4d94327ae725b905804047a7c4686684ba60dfb15ef54'),
 'ops/c720p/s9-native-security/fast-recent-s9-clip-index.py':('s9-fast-recent-clip-index.py','6508d170fb0a917e3384aa1c7d2059aff3da163440371108f05ebcee62ec427a'),
 'ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py':('s9_sd_proxy_extension.py','b4abc54b46ca558a5fcf1591d6dce401547407d138301f7840de6f1db28e53f5'),
}
TESTS=['ops/c720p/security-runtime/test-phone-archive-catalog-v1.py',
       'ops/c720p/security-runtime/test-phone-archive-adapters-v1.py',
       'ops/c720p/s9-native-security/test-phone-native-media-range-proxy.py']
TIMERS=['c720p-s9-fast-recent-clips.timer','c720p-s9-local-sd-catalog.timer']
SERVICES=['c720p-drive-security-archive.service','c720p-security-web.service']
def sha(raw):return hashlib.sha256(raw).hexdigest()
def run(args,timeout=60):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('command_failed:'+str(args[:3])+':'+p.stderr[-600:])
 return p.stdout
def ctl(*args,timeout=60):return run(['systemctl','--user',*args],timeout)
def active(unit):return subprocess.run(['systemctl','--user','is-active','--quiet',unit],capture_output=True).returncode==0
def get(port,path):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=30) as r:return json.load(r)
def camera():
 s=get(18808,'/status')
 if not (s.get('ok') is True and s.get('mode') in ('watching','recording') and s.get('continuous_4k_ready') is True and s.get('continuous_4k_dropped_output_frames')==0):
  raise RuntimeError('camera_4k_unhealthy')
 return s
def originals():return {r['clip_no'] for r in get(8795,'/new/api/saved')['events'] if re.fullmatch(r'motion_[0-9]{13}[.]mp4',r.get('clip_no',''))}
def reviews():
 p=ROOT/'state/s9-visual-attributes-v36/review.sqlite3'
 with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True) as db:primary=sha('\n'.join(db.iterdump()).encode())
 # The manual link store is a separate API; compare the complete revisioned
 # document, not only the number of people or assignments.
 links=get(8795,'/new/api/s9-manual-recording-links')
 if links.get('ok') is not True or links.get('manual_links_only') is not True:raise RuntimeError('manual_link_contract')
 return primary,sha(json.dumps({'revision':links.get('revision'),'items':links.get('items')},sort_keys=True,separators=(',',':')).encode())
def atomic(path,raw,mode):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.s9-offload-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--ref',required=True);ap.add_argument('--apply',action='store_true');args=ap.parse_args()
 if not re.fullmatch(r'[a-f0-9]{40}',args.ref):raise ValueError('immutable_ref_required')
 stage=ROOT/'build'/('phone-archive-offload-'+args.ref[:12]);stage.mkdir(parents=True,exist_ok=True)
 for path in [*FILES,*TESTS]:
  dest=stage/path;dest.parent.mkdir(parents=True,exist_ok=True)
  with urllib.request.urlopen('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+args.ref+'/'+path,timeout=40) as r:raw=r.read(500001)
  if not 50<len(raw)<500000:raise ValueError('unbounded_source')
  compile(raw,str(dest),'exec');dest.write_bytes(raw)
 for path in TESTS:
  print('STAGED_TEST',path,run(['python3',str(stage/path)],timeout=45),flush=True)
 changes={};old={};modes={}
 for source,(name,expected) in FILES.items():
  target=ROOT/'bin'/name;raw=(stage/source).read_bytes();before=target.read_bytes() if target.exists() else None
  if before==raw:continue
  if (sha(before) if before is not None else None)!=expected:raise RuntimeError('live_predecessor_changed:'+name)
  changes[target]=raw;old[target]=before;modes[target]=stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o600
 if not args.apply:print('PHONE_ARCHIVE_ADAPTERS_STAGED_NOT_DEPLOYED',len(changes),args.ref,flush=True);return
 spec=importlib.util.spec_from_file_location('staged_phone_catalog',stage/'ops/c720p/security-runtime/phone_archive_catalog_v1.py');client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)
 native=client.load_catalog(stage/'native-preflight.json');before=originals();review_hash=reviews();phone=camera()
 if set(native['records'])!=before or len(before)<70:raise RuntimeError('native_catalog_not_equal_to_original_archive')
 backup=ROOT/'backups/security-offload-v1'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(parents=True,mode=0o700)
 for path,raw in old.items():
  if raw is not None:atomic(backup/path.name,raw,modes[path])
 index=WEB/'s9-phone-events.json';index_before=index.read_bytes();index_mode=stat.S_IMODE(index.stat().st_mode);atomic(backup/'s9-phone-events.json',index_before,0o600)
 atomic(backup/'manifest.json',json.dumps({str(p):{'before':sha(old[p]) if old[p] else None,'after':sha(changes[p])} for p in changes},indent=2).encode(),0o600)
 timers=[u for u in TIMERS if active(u)];written=[]
 try:
  for u in timers:ctl('stop',u)
  deadline=time.monotonic()+160
  while any(active(u.replace('.timer','.service')) for u in TIMERS):
   if time.monotonic()>deadline:raise RuntimeError('catalog_job_still_active')
   time.sleep(2)
  for path,raw in changes.items():
   if (path.read_bytes() if path.exists() else None)!=old[path]:raise RuntimeError('live_source_lease_lost:'+path.name)
   atomic(path,raw,modes[path]);written.append(path)
  for u in SERVICES:ctl('restart',u)
  for _ in range(15):
   try:
    if before.issubset(originals()):break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError('archive_not_restored_after_restart')
  ctl('start','c720p-s9-local-sd-catalog.service',timeout=220)
  ctl('start','c720p-s9-fast-recent-clips.service',timeout=90)
  after=originals()
  if not before.issubset(after):raise RuntimeError('original_recordings_missing')
  if reviews()!=review_hash:raise RuntimeError('manual_reviews_changed_concurrently')
  index_data=json.loads(index.read_text())
  if index_data.get('errors'):raise RuntimeError('catalog_errors_after_offload')
  native_rows=[r for r in index_data['phone_recordings'] if r.get('name') in before]
  if len(native_rows)!=len(before) or any(not r.get('phone_catalog_version') for r in native_rows):raise RuntimeError('native_adapter_not_active')
  sample=next(iter(sorted(before)))
  try:urllib.request.urlopen('http://127.0.0.1:8795/new/saved/clip/'+sample+'?playback=prepare',timeout=10);raise RuntimeError('removed_playback_still_active')
  except urllib.error.HTTPError as e:
   if e.code!=410:raise
  current=camera()
  print('PHONE_ARCHIVE_OFFLOAD_LIVE_VERIFIED',json.dumps({'ref':args.ref,'backup':str(backup),'native_recordings':len(native_rows),'originals_preserved':len(after),'manual_reviews_unchanged':True,'playback_copy_endpoint':410,'temperature_c':current.get('temperature_c'),'dropped_output_frames':current.get('continuous_4k_dropped_output_frames')}),flush=True)
 except BaseException:
  for path in reversed(written):
   if path.read_bytes()!=changes[path]:raise RuntimeError('rollback_refused_newer_source:'+path.name)
   if old[path] is None:path.unlink()
   else:atomic(path,old[path],modes[path])
  atomic(index,index_before,index_mode)
  for u in SERVICES:ctl('restart',u)
  raise
 finally:
  for u in timers:ctl('start',u)
if __name__=='__main__':main()
