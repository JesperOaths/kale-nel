#!/usr/bin/env python3
"""Deploy a locally staged, hash-pinned Security UI and metadata bundle.

Only the fixed UI and two metadata service files below are writable. The
camera APK, camera settings, media and admin routes are never changed.
All previous bytes are backed up and restored on failed service/readback checks.
"""
import argparse,datetime,hashlib,importlib.util,json,os,pathlib,subprocess,tempfile,time,urllib.request
WWW=pathlib.Path('/opt/homeassistant/config/www')
BIN=pathlib.Path('/home/jespern/c720p-home-hub/bin')
BACK=pathlib.Path('/home/jespern/c720p-home-hub/backups/security-hub-v30')
TARGETS={
 'security-hub-v30.html':WWW/'c720p-surveillance.html',
 **{n:WWW/'frontyard-security-new'/n for n in ['security-hub-v30.css','security-hub-v30.js','security-video-playback-v30.js','security-review-v8.html','security-face-folders-v22.html','security-tracks-v7.html','security-archive-v7.html']},
 'local-sd-catalog.py':BIN/'c720p-s9-local-sd-catalog.py',
 's9_sd_proxy_extension.py':BIN/'s9_sd_proxy_extension.py',
 's9_phone_garden_status.py':BIN/'s9_phone_garden_status.py',
}
def sha(blob):return hashlib.sha256(blob).hexdigest()
def get(path):
 with urllib.request.urlopen('http://127.0.0.1:8794'+path,timeout=30) as r:return json.load(r)
def atomic(path,blob,meta=None):
 fd,temp=tempfile.mkstemp(prefix='.security-v30-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(blob);f.flush();os.fsync(f.fileno())
  os.chmod(temp,(meta.st_mode&0o777) if meta else 0o600)
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def run(stage,apply):
 manifest=json.loads((stage/'manifest.json').read_text())
 if set(manifest)!=set(TARGETS):raise RuntimeError('Unexpected bundle files')
 before={};new={}
 for name,path in TARGETS.items():
  if path.is_symlink() or (path.exists() and not path.is_file()):raise RuntimeError('Unsafe target '+name)
  old=path.read_bytes() if path.exists() else None
  if (sha(old) if old is not None else None)!=manifest[name]['before_sha256']:raise RuntimeError('Concurrent production change '+name)
  blob=(stage/name).read_bytes()
  if sha(blob)!=manifest[name]['sha256']:raise RuntimeError('Staged digest mismatch '+name)
  if name.endswith('.py'):compile(blob.decode(),name,'exec')
  before[path]=(old,path.stat() if path.exists() else None);new[path]=blob
 pre=get('/new/api/saved');live=get('/new/api/live-person-watch');controls=get('/new/camera-controls')
 if pre.get('archive_mode')!='S9-microSD-only' or not pre.get('events'):raise RuntimeError('Archive unavailable')
 if not controls.get('ok'):raise RuntimeError('Camera controls unavailable')
 if not live.get('ok'):
  # A compatible reporter update may be exactly why old telemetry is unavailable.
  # Validate the staged allowlist against fresh real phone status before writing.
  spec=importlib.util.spec_from_file_location('staged_garden_status',stage/'s9_phone_garden_status.py')
  candidate=importlib.util.module_from_spec(spec);spec.loader.exec_module(candidate)
  with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=15) as r:phone=json.loads(r.read(16001))
  live=candidate.from_phone(phone)
  if not live.get('ok'):raise RuntimeError('Fresh phone validation failed')
 names={r['clip_no'] for r in pre['events']}
 result={'dry_run':not apply,'files':len(new),'recordings_before':len(names),'control_keys':list(controls['controls'])}
 if not apply:print(json.dumps(result),flush=True);return
 if subprocess.run(['systemctl','--user','is-active','c720p-s9-local-sd-catalog.service'],text=True,capture_output=True).stdout.strip()=='active':raise RuntimeError('Catalog refresh already running')
 BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
 backup=BACK/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(mode=0o700)
 record={};written=[]
 for i,(path,(blob,meta)) in enumerate(before.items()):
  if blob is not None:
   copy=backup/(str(i)+'-'+path.name);copy.write_bytes(blob);os.chmod(copy,0o600)
   if copy.read_bytes()!=blob:raise RuntimeError('Backup mismatch')
   record[str(path)]={'backup':str(copy),'mode':meta.st_mode&0o777}
  else:record[str(path)]={'backup':None}
 (backup/'restore.json').write_text(json.dumps(record,indent=2));os.chmod(backup/'restore.json',0o600)
 try:
  # Install child assets and services first, then the single root entrypoint.
  ordered=[p for p in new if p!=WWW/'c720p-surveillance.html' and new[p]!=before[p][0]]
  if new[WWW/'c720p-surveillance.html']!=before[WWW/'c720p-surveillance.html'][0]:ordered.append(WWW/'c720p-surveillance.html')
  for path in ordered:
   old,meta=before[path]
   if (path.read_bytes() if path.exists() else None)!=old:raise RuntimeError('Concurrent UI/service write')
   atomic(path,new[path],meta);written.append(path)
   if path.read_bytes()!=new[path]:raise RuntimeError('Write mismatch')
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],check=True,timeout=35)
  for attempt in range(20):
   try:
    after=get('/new/api/saved');break
   except Exception:
    if attempt==19:raise
    time.sleep(.5)
  if not names.issubset({r['clip_no'] for r in after.get('events',[])}):raise RuntimeError('Archive regressed')
  for name,path in TARGETS.items():
   if name.endswith('.py'):continue
   relative=str(path.relative_to(WWW))
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+relative+'?v=security-v30',timeout=20) as response:
    served=response.read(600000)
   if sha(served)!=sha(new[path]):raise RuntimeError('HA asset readback mismatch '+name)
  if not get('/new/camera-controls').get('ok') or not get('/new/api/live-person-watch').get('ok'):raise RuntimeError('Camera health regressed')
  # Metadata rebuild reads existing signed sidecars and thumbnails only.
  catalog_changed=BIN/'c720p-s9-local-sd-catalog.py' in written
  if catalog_changed:subprocess.run(['systemctl','--user','start','--no-block','c720p-s9-local-sd-catalog.service'],check=True,timeout=10)
  result.update({'backup':str(backup),'installed':True,'changed_files':len(written),'assets_verified':8,'recordings_after':len(after['events']),'catalog_refresh_started':catalog_changed,'camera_restarted':False,'media_changed':False})
  print(json.dumps(result),flush=True)
 except BaseException:
  for path in reversed(written):
   blob,meta=before[path]
   if blob is None:path.unlink(missing_ok=True)
   else:atomic(path,blob,meta)
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],timeout=35)
  print('SECURITY_V30_ROLLED_BACK '+str(backup),flush=True);raise
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--stage',type=pathlib.Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();run(a.stage,a.apply)
