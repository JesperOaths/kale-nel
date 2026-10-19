#!/usr/bin/env python3
"""Guarded hub-only catalog repair. Does not alter Camera2, media or reviews."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile

HOME=Path('/home/jespern/c720p-home-hub')
BASE=Path('/opt/homeassistant/config/www/frontyard-security-new')
RUNTIME='ops/c720p/security-runtime/'
FULL='ops/c720p/s9-person-ml-v1/local-sd-catalog.py'
FAST='ops/c720p/s9-native-security/fast-recent-s9-clip-index.py'
TARGETS={
 RUNTIME+'phone_archive_catalog_v1.py':('phone_archive_catalog_v1.py','356e6b9984cf3f485863ea79d379f464ab5b37025fc81662de86cea4110a6f36'),
 RUNTIME+'s9_standalone_phone_catalog_v1.py':('s9_standalone_phone_catalog_v1.py','c553e309934c2ae1d4f6723fe898bfc9909d29ea400cf91d7516cdab97933652'),
 FULL:('c720p-s9-local-sd-catalog.py','db37d7b4447fbf6ff3a4d94327ae725b905804047a7c4686684ba60dfb15ef54'),
 FAST:('s9-fast-recent-clip-index.py','6e4bde7fcdbe16e5f338478dc8c1391bed732fd66375fa8af0d1f0e2da65697e')}
UNITS=['c720p-s9-standalone-catalog','c720p-s9-fast-recent-clips','c720p-s9-local-sd-catalog']
TESTS=[RUNTIME+'test-phone-archive-catalog-v1.py',RUNTIME+'test-phone-archive-adapters-v1.py',
 RUNTIME+'test-s9-standalone-phone-catalog-v1.py']

def sha(data):return hashlib.sha256(data).hexdigest()
def fetch(ref,path):
 with urllib.request.urlopen('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+ref+'/'+path,timeout=30) as r:
  raw=r.read(200001)
 if not 100<len(raw)<=200000:raise RuntimeError('source_size')
 compile(raw,path,'exec')
 return raw
def atomic(path,data,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.catalog-continuity-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def command(args,timeout=20):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError('command_failed:'+r.stderr[-500:])
 return r.stdout
def active(unit):
 return subprocess.run(['systemctl','--user','is-active','--quiet',unit],capture_output=True).returncode==0
def ctl(verb,unit,timeout=20):return command(['systemctl','--user',verb,unit],timeout)
def api(port,path):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=18) as r:raw=r.read(6000001)
 if len(raw)>6000000:raise RuntimeError('api_size')
 return json.loads(raw)
def camera():
 s=api(18808,'/status')
 if (s.get('ok') is not True or s.get('continuous_4k_ready') is not True or
     s.get('native_4k_enabled') is not True or s.get('continuous_4k_dropped_output_frames')!=0 or
     s.get('mode') not in ('watching','recording')):raise RuntimeError('capture_not_healthy')
 return s
def archive():
 d=api(8795,'/new/api/saved')
 if d.get('ok') is not True or d.get('archive_mode')!='S9-microSD-only' or not isinstance(d.get('events'),list):
  raise RuntimeError('archive_unavailable')
 names={r.get('clip_no') for r in d['events'] if isinstance(r,dict)}
 if not names or len(names)!=len(d['events']):raise RuntimeError('archive_duplicate_or_empty')
 return names
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--ref',required=True);ap.add_argument('--apply',action='store_true')
 ap.add_argument('--bundle',type=Path);ap.add_argument('--bundle-sha256');a=ap.parse_args()
 if not re.fullmatch('[a-f0-9]{40}',a.ref):raise ValueError('immutable_ref')
 if shutil.disk_usage(HOME).free<64*1024*1024:raise RuntimeError('disk_reserve')
 stage=HOME/'build/catalog-continuity'/a.ref
 paths=list(TARGETS)+TESTS+[RUNTIME+'phone_archive_catalog_v1.py',FULL,FAST,
  'ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py']
 bodies={}
 archive_source=None
 if a.bundle:
  if (a.bundle.is_symlink() or not a.bundle.is_file() or a.bundle.stat().st_size>250000
      or not re.fullmatch('[a-f0-9]{64}',a.bundle_sha256 or '')
      or sha(a.bundle.read_bytes())!=a.bundle_sha256):raise RuntimeError('invalid_private_source_bundle')
  archive_source=zipfile.ZipFile(a.bundle)
  if set(archive_source.namelist())!=set(paths) or len(archive_source.namelist())!=len(set(paths)):
   raise RuntimeError('unexpected_private_bundle_files')
 try:
  for rel in dict.fromkeys(paths):
   if archive_source:
    if archive_source.getinfo(rel).file_size>200000:raise RuntimeError('source_size')
    b=archive_source.read(rel);compile(b,rel,'exec')
   else:b=fetch(a.ref,rel)
   bodies[rel]=b;atomic(stage/rel,b)
 finally:
  if archive_source:archive_source.close()
 for test in TESTS:command(['/usr/bin/python3',str(stage/test)],timeout=60)
 old={};modes={}
 for rel,(name,pin) in TARGETS.items():
  p=HOME/'bin'/name
  if p.is_symlink() or not p.is_file() or sha(p.read_bytes()) not in (pin,sha(bodies[rel])):
   raise RuntimeError('concurrent_source_change:'+name)
  old[p]=p.read_bytes();modes[p]=p.stat().st_mode&0o777
 before=archive();camera()
 print('CATALOG_CONTINUITY_PREFLIGHT '+json.dumps({'recordings':len(before),'regression_suites':len(TESTS),'apply':a.apply}),flush=True)
 if not a.apply:return
 backup=HOME/'backups/catalog-continuity'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for p,b in old.items():atomic(backup/p.name,b)
 timers=[u+'.timer' for u in UNITS if active(u+'.timer')]
 changed=[];state_before={};snapshot_paths=[BASE/'s9-phone-events.json',HOME/'state/s9-fallback-evidence.json',
  HOME/'state/s9-standalone-archive-catalog-v1.json',HOME/'state/s9-standalone-archive-summary-v1.json',
  HOME/'state/s9-native-archive-client.json']
 try:
  for u in timers:ctl('stop',u)
  end=time.monotonic()+180
  while any(active(u+'.service') for u in UNITS):
   if time.monotonic()>end:raise RuntimeError('indexer_busy')
   time.sleep(2)
  for p,b in old.items():
   if p.read_bytes()!=b:raise RuntimeError('source_lease_changed')
  for i,p in enumerate(snapshot_paths):
   if p.is_symlink():raise RuntimeError('unexpected_state_symlink')
   state_before[p]=(p.read_bytes(),p.stat().st_mode&0o777) if p.exists() else None
   if p.exists():atomic(backup/('state-'+str(i)+'.json'),state_before[p][0])
  with (HOME/'state/s9-native-catalog.lock').open('a+') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   for rel,(name,_) in TARGETS.items():
    p=HOME/'bin'/name
    if old[p]!=bodies[rel]:atomic(p,bodies[rel],modes[p]);changed.append(p)
  # The metadata worker and both indexers are oneshots. Never restart capture,
  # the archive relay, Home Assistant or any user-facing camera service.
  resources={}
  for u in [UNITS[0],UNITS[2],UNITS[1]]:
   ctl('start',u+'.service',timeout=330)
   camera()
   resources[u]=command(['systemctl','--user','show',u+'.service','-p','Result','-p','CPUUsageNSec','-p','MemoryPeak']).strip()
  after=archive();index=json.loads((BASE/'s9-phone-events.json').read_text())
  if not before<=after or index.get('errors'):raise RuntimeError('archive_continuity_failed')
  for rel,(name,_) in TARGETS.items():
   if sha((HOME/'bin'/name).read_bytes())!=sha(bodies[rel]):raise RuntimeError('installed_hash_mismatch')
  print('CATALOG_CONTINUITY_LIVE_VERIFIED '+json.dumps({'before':len(before),'after':len(after),
   'backup':str(backup),'source_ref':a.ref,'resources':resources,
   'camera_apk_changed':False,'originals_changed':False,'reviews_changed':False}),flush=True)
 except BaseException:
  for p in reversed(changed):atomic(p,old[p],modes[p])
  if changed:
   for p,previous in state_before.items():
    if previous is not None:atomic(p,*previous)
    elif p.exists():p.unlink()
   print('CATALOG_CONTINUITY_ROLLED_BACK',flush=True)
  raise
 finally:
  for u in timers:ctl('start',u)
if __name__=='__main__':main()
