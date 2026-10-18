#!/usr/bin/env python3
"""Guarded 32 KiB manifest contract for both phone catalog paths."""
import argparse,datetime,hashlib,json,os,re,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path('/home/jespern/c720p-home-hub')
CATALOG='ops/c720p/s9-person-ml-v1/local-sd-catalog.py'
FAST='ops/c720p/s9-native-security/fast-recent-s9-clip-index.py'
TEST='ops/c720p/security-runtime/test-manifest-bounds-v1.py'
OLD_TEST='ops/c720p/s9-native-security/test-fast-recent-s9-clip-index.py'
OLD_DEPLOY='ops/c720p/s9-native-security/deploy-fast-face-v26.py'
PINS={'ops/c720p/s9-person-ml-v1/local-sd-catalog.py': 'db37d7b4447fbf6ff3a4d94327ae725b905804047a7c4686684ba60dfb15ef54', 'ops/c720p/s9-native-security/fast-recent-s9-clip-index.py': '6508d170fb0a917e3384aa1c7d2059aff3da163440371108f05ebcee62ec427a', 'ops/c720p/security-runtime/test-manifest-bounds-v1.py': '1829eab8f27cf72838bf8d5b5237405fa59762b8893d31d6de00b82233cdb743', 'ops/c720p/s9-native-security/test-fast-recent-s9-clip-index.py': '82e595eeb27b21d7f88f61839fa5d3de2f3a48d1f332736e914f2529160e8e60', 'ops/c720p/s9-native-security/deploy-fast-face-v26.py': '115940834f451af6376c653750bbe94eacbbc5e2fb1a21e63ce3a61058bb7d91'}
TARGETS={'ops/c720p/s9-person-ml-v1/local-sd-catalog.py': ('c720p-s9-local-sd-catalog.py', 'a0a53b76b8c1380165c814c706f38eb057a29146b109c03163c0ad7aeddf4e7e'), 'ops/c720p/s9-native-security/fast-recent-s9-clip-index.py': ('s9-fast-recent-clip-index.py', 'add0c6ee59075407451a742d00c4289f6bb8c50afc24acc3dfa1a3c936a2f9fb')}
UNITS=['c720p-s9-local-sd-catalog','c720p-s9-fast-recent-clips']

def sha(b):return hashlib.sha256(b).hexdigest()
def run(cmd,timeout=45):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('command_failed:'+p.stderr[-500:])
 return p.stdout
def ctl(*args,timeout=45):return run(['systemctl','--user',*args],timeout)
def active(unit):return subprocess.run(['systemctl','--user','is-active','--quiet',unit]).returncode==0
def atomic(path,b,mode=0o600):
 fd,tmp=tempfile.mkstemp(prefix='.manifest-bound-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def clips():
 with urllib.request.urlopen('http://127.0.0.1:8795/new/api/saved',timeout=15) as r:d=json.load(r)
 if d.get('ok') is not True or d.get('archive_mode')!='S9-microSD-only':raise ValueError('archive_unavailable')
 return {e['clip_no'] for e in d['events']}

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--ref',required=True);ap.add_argument('--apply',action='store_true');a=ap.parse_args()
 if not re.fullmatch('[a-f0-9]{40}',a.ref):raise ValueError('immutable_ref_required')
 stage=ROOT/'build/security-manifest-bounds'/a.ref;bodies={}
 for rel,pin in PINS.items():
  with urllib.request.urlopen('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+a.ref+'/'+rel,timeout=30) as r:b=r.read(100001)
  if len(b)>100000 or sha(b)!=pin:raise ValueError('source_pin_mismatch')
  p=stage/rel;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);atomic(p,b);compile(b,str(p),'exec');bodies[rel]=b
 for rel in [TEST,OLD_TEST]:run(['/usr/bin/python3',str(stage/rel)])
 old={};modes={}
 for rel,(name,pin) in TARGETS.items():
  p=ROOT/'bin'/name
  if p.is_symlink() or sha(p.read_bytes())!=pin:raise ValueError('concurrent_indexer_update:'+name)
  old[p]=p.read_bytes();modes[p]=p.stat().st_mode&0o777
 before=clips();print('MANIFEST_PREFLIGHT',json.dumps({'originals':len(before),'tests':8,'apply':a.apply}),flush=True)
 if not a.apply:return
 backup=ROOT/'backups/security-manifest-bounds'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(mode=0o700,parents=True)
 for p,b in old.items():atomic(backup/p.name,b,modes[p])
 timers=[u+'.timer' for u in UNITS if active(u+'.timer')];changed=False
 index_path=Path('/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json')
 try:
  for u in timers:ctl('stop',u)
  end=time.monotonic()+180
  while any(active(u+'.service') for u in UNITS):
   if time.monotonic()>end:raise RuntimeError('indexer_busy_no_changes')
   time.sleep(2)
  for p,b in old.items():
   if p.read_bytes()!=b:raise ValueError('final_source_lease_changed')
  index_before=index_path.read_bytes();index_mode=index_path.stat().st_mode&0o777
  atomic(backup/'s9-phone-events.json',index_before,index_mode)
  changed=True
  for rel,(name,_) in TARGETS.items():p=ROOT/'bin'/name;atomic(p,bodies[rel],modes[p])
  for u in UNITS:ctl('start',u+'.service',timeout=300)
  after=clips()
  index=json.loads(index_path.read_text())
  if not before<=after or index.get('errors'):raise RuntimeError('index_completeness_regression')
  print('MANIFEST_LIVE_VERIFIED',json.dumps({'ref':a.ref,'backup':str(backup),'originals':len(after),'errors':index.get('errors'),'manifest_limit_bytes':32768}),flush=True)
 except BaseException:
  if changed:
   for p,b in old.items():atomic(p,b,modes[p])
   atomic(index_path,index_before,index_mode)
  raise
 finally:
  for u in timers:ctl('start',u)

if __name__=='__main__':main()
