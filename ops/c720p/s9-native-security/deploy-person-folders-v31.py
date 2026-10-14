"""Guarded hub-only person-folder deployment; camera installation is separate."""
import argparse,datetime,hashlib,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');BIN=BASE/'bin';WWW=Path('/opt/homeassistant/config/www')
TARGETS={'security-face-folders-v22.html':WWW/'frontyard-security-new/security-face-folders-v22.html',
 'security-hub-v30.html':WWW/'c720p-surveillance.html','security-hub-v30.js':WWW/'frontyard-security-new/security-hub-v30.js',
 'local-sd-catalog.py':BIN/'c720p-s9-local-sd-catalog.py','s9_sd_proxy_extension.py':BIN/'s9_sd_proxy_extension.py',
 's9_person_folders_v31.py':BIN/'s9_person_folders_v31.py','c720p-lan-camera-relay-v31.py':BIN/'c720p-lan-camera-relay.py'}
def sha(b):return hashlib.sha256(b).hexdigest() if b is not None else None
def get(path,port=8794):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=25) as r:return json.load(r)
def atomic(path,data,mode):
 fd,tmp=tempfile.mkstemp(prefix='.person-folders-v31-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def restart():
 for unit in ('c720p-drive-security-archive.service','c720p-lan-camera-relay.service'):
  subprocess.run(['systemctl','--user','restart',unit],check=True,timeout=35)
def main():
 p=argparse.ArgumentParser();p.add_argument('--stage',type=Path,required=True);p.add_argument('--capture-before',action='store_true');a=p.parse_args()
 manifest=json.loads((a.stage/'manifest.json').read_text());assert set(manifest)==set(TARGETS)
 before={};new={}
 for name,path in TARGETS.items():
  if path.is_symlink() or (path.exists() and not path.is_file()):raise RuntimeError('unsafe_target')
  old=path.read_bytes() if path.exists() else None
  before[path]=(old,path.stat().st_mode&0o777 if old is not None else 0o600)
  new[path]=(a.stage/name).read_bytes()
  if sha(new[path])!=manifest[name]['sha256']:raise RuntimeError('stage_digest_'+name)
  if name.endswith('.py'):compile(new[path].decode(),name,'exec')
  if a.capture_before:manifest[name]['before_sha256']=sha(old)
  elif sha(old)!=manifest[name]['before_sha256']:raise RuntimeError('concurrent_change_'+name)
 if a.capture_before:
  (a.stage/'manifest.json').write_text(json.dumps(manifest,indent=2));print('BEFORE_HASHES_CAPTURED');return
 saved=get('/new/api/saved');names={r['clip_no'] for r in saved['events']}
 if saved.get('archive_mode')!='S9-microSD-only' or not names:raise RuntimeError('archive_not_available')
 if subprocess.run(['systemctl','--user','is-active','c720p-s9-local-sd-catalog.service'],capture_output=True,text=True).stdout.strip()=='active':raise RuntimeError('catalog_refresh_running')
 backup=BASE/'backups/person-folders-v31'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(mode=0o700,parents=True)
 recovery={};written=[]
 for i,(path,(old,mode)) in enumerate(before.items()):
  copy=backup/(str(i)+'-'+path.name)
  if old is not None:copy.write_bytes(old);os.chmod(copy,0o600);assert copy.read_bytes()==old
  recovery[str(path)]={'backup':str(copy) if old is not None else None,'mode':mode}
 (backup/'restore.json').write_text(json.dumps(recovery,indent=2));os.chmod(backup/'restore.json',0o600)
 try:
  for path,blob in new.items():
   actual=path.read_bytes() if path.exists() else None
   if actual!=before[path][0]:raise RuntimeError('concurrent_write')
   atomic(path,blob,before[path][1]);written.append(path)
  restart();last=None
  for attempt in range(20):
   try:
    after=get('/new/api/saved');folders=get('/new/api/person-folders',8795);relay=get('/new/api/person-folders',8794)
    if not names.issubset({r['clip_no'] for r in after['events']}):raise RuntimeError('archive_lost_clips')
    if not folders.get('ok') or folders.get('version')!='s9_person_folders_v31' or relay!=folders:raise RuntimeError('folder_api_not_ready')
    break
   except Exception as error:last=error;time.sleep(.5)
  else:raise last
  for name,path in TARGETS.items():
   if path.suffix not in ('.html','.js'):continue
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+str(path.relative_to(WWW))+'?v=person-folders-v31',timeout=20) as r:served=r.read(600000)
   if sha(served)!=sha(new[path]):raise RuntimeError('served_asset_mismatch_'+name)
  print(json.dumps({'installed':True,'camera_package_changed':False,'media_changed':False,'recordings_before':len(names),'recordings_after':len(after['events']),'person_folders':folders['summary'],'backup':str(backup)},sort_keys=True))
 except BaseException:
  for path in reversed(written):
   old,mode=before[path]
   if old is None:path.unlink(missing_ok=True)
   else:atomic(path,old,mode)
  restart();print('PERSON_FOLDERS_V31_ROLLED_BACK',str(backup));raise
if __name__=='__main__':main()
