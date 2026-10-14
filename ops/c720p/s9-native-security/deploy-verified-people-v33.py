"""Guarded hub-only verified-person UI deployment; does not run inference."""
import argparse,fcntl,hashlib,json,os,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');WWW=Path('/opt/homeassistant/config/www');STATE=BASE/'state/s9-verified-people-v33'
TARGETS={name:WWW/'frontyard-security-new'/name for name in ('security-people-v33.html','security-people-v33.js','security-hub-v30.js','security-archive-v7.html','archive-review-v32.js')}
TARGETS.update({name:BASE/'bin'/name for name in ('s9_verified_people_v33.py','s9_archive_review_v32.py','s9_sd_proxy_extension.py','verified-people-worker-v33.py','verified-people-publisher-v33.py','prepare-verified-people-runtime-v33.py','refine-verified-motion-v33.py','finish-verified-people-v33.py','verify-people-live-v33.py')})
TARGETS.update({'security-hub-v30.html':WWW/'c720p-surveillance.html','c720p-lan-camera-relay-v33.py':BASE/'bin/c720p-lan-camera-relay.py','refine-native-faces-v33.py':BASE/'bin/refine-native-faces-v33.py'})
def sha(blob):return hashlib.sha256(blob).hexdigest() if blob is not None else None
def get(path,port=8794):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=25) as response:return json.load(response)
def atomic(path,blob,mode):
 fd,temp=tempfile.mkstemp(dir=path.parent,prefix='.people-v33-')
 try:
  with os.fdopen(fd,'wb') as out:out.write(blob);out.flush();os.fsync(out.fileno())
  os.chmod(temp,mode);os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def restart(relay=True):
 for unit in (('c720p-drive-security-archive.service','c720p-lan-camera-relay.service') if relay else ('c720p-drive-security-archive.service',)):subprocess.run(['systemctl','--user','restart',unit],check=True,timeout=35)
def post_denied(path,headers,body,expected):
 request=urllib.request.Request('http://127.0.0.1:8794'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=15) as response:status=response.status
 except urllib.error.HTTPError as error:status=error.code;error.close()
 assert status==expected,(path,status,expected)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True,type=Path);parser.add_argument('--final-only',action='store_true');args=parser.parse_args();final_names={'s9_verified_people_v33.py','verified-people-worker-v33.py','refine-verified-motion-v33.py','refine-native-faces-v33.py','finish-verified-people-v33.py','verify-people-live-v33.py','security-people-v33.html','security-people-v33.js','security-hub-v30.js','security-hub-v30.html'};targets={k:v for k,v in TARGETS.items() if not args.final_only or k in final_names};manifest=json.loads((args.stage/'manifest.json').read_text());assert set(manifest)==set(targets)
 approval=json.loads((STATE/'approval.json').read_text());assert approval['owner_signal']=='yes, done' and approval['version']=='verified_people_v33';approved={c['source']+':'+c['name'] for c in approval['clips']}
 before={};new={}
 for name,path in targets.items():
  assert not path.is_symlink() and (not path.exists() or path.is_file());old=path.read_bytes() if path.exists() else None;blob=(args.stage/name).read_bytes()
  assert sha(old)==manifest[name]['before_sha256'],'concurrent_change_'+name;assert sha(blob)==manifest[name]['sha256'],'stage_digest_'+name
  if name.endswith('.py'):compile(blob.decode(),name,'exec')
  before[path]=(old,path.stat().st_mode&0o777 if old is not None else (0o600 if name.endswith('.py') else 0o644));new[path]=blob
 subprocess.run(['systemctl','--user','is-active','c720p-agent-runner.service'],check=True,capture_output=True,timeout=10)
 camera=get('/status',18808);assert camera['mode'] in ('watching','recording')
 from datetime import datetime,timezone
 backup=BASE/'backups/verified-people-v33'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(parents=True,mode=0o700);restore={};written=[]
 for index,(path,(old,mode)) in enumerate(before.items()):
  copy=backup/(str(index)+'-'+path.name)
  if old is not None:copy.write_bytes(old);os.chmod(copy,0o600)
  restore[str(path)]={'backup':str(copy) if old is not None else None,'mode':mode}
 (backup/'restore.json').write_text(json.dumps(restore,indent=2));os.chmod(backup/'restore.json',0o600)
 try:
  for path,blob in new.items():
   assert (path.read_bytes() if path.exists() else None)==before[path][0],'concurrent_write'
   atomic(path,blob,before[path][1]);written.append(path)
  restart(not args.final_only);last=None
  for attempt in range(30):
   try:
    result=get('/new/api/verified-people');sd=get('/new/api/archive-review?source=sd');drive=get('/new/api/archive-review?source=drive')
    assert result['ok'] and result['matching_started'] and sd['matching_started'] and drive['matching_started']
    assert all(t['clip_key'] in approved for f in result['folders'] for t in f['items'])
    break
   except Exception as error:last=error;time.sleep(.5)
  else:raise last
  for name,path in targets.items():
   if path.suffix not in ('.js','.html'):continue
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+str(path.relative_to(WWW))+'?v=verified-people-v33-20261014',timeout=20) as response:served=response.read(600000)
   assert sha(served)==sha(new[path]),'served_asset_mismatch_'+name
  # All these writes fail before acquiring the registry lock. No user labels change.
  with (STATE/'registry.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX);registry=STATE/'registry.json';old_registry=registry.read_bytes()
   origin={'Origin':'http://192.168.178.141:8123'};intent={'X-S9-Verified-People-Intent':'owner-folder-review-v33'}
   post_denied('/new/api/verified-people/review',origin,{},403)
   post_denied('/new/api/verified-people/review',{**intent,'Origin':'http://untrusted.invalid'}, {},403)
   post_denied('/new/api/verified-people/review',{**origin,**intent},{'action':'confirm','profile_id':'P0001','human_confirmed':False},400)
   post_denied('/new/api/person-folders/review',{**origin,'X-S9-Person-Folder-Intent':'explicit-review-v31'}, {},423)
   assert registry.read_bytes()==old_registry,'unexpected_registry_write'
  image=next((t['body_image'] for f in result['folders'] for t in f['items'] if t.get('body_image')),None)
  if image:
   with urllib.request.urlopen('http://127.0.0.1:8794/new/api/verified-people/image/'+image,timeout=15) as response:blob=response.read(600001);assert response.status==200 and blob.startswith(b'\xff\xd8') and len(blob)<=600000
  try:urllib.request.urlopen('http://127.0.0.1:8794/new/api/verified-people/image/'+'f'*24+'.jpg',timeout=10);raise ValueError('unindexed_image_exposed')
  except urllib.error.HTTPError as error:assert error.code==404;error.close()
  camera=get('/status',18808);assert camera['mode'] in ('watching','recording')
  print(json.dumps({'installed':True,'approved_clips':result['approved_clips'],'processed_clips':result['processed_clips'],'folders':len(result['folders']),'metrics':result['metrics'],'negative_write_guards':4,'indexed_image_verified':bool(image),'camera_mode':camera['mode'],'camera_package_changed':False,'backup':str(backup)},sort_keys=True))
 except BaseException:
  for path in reversed(written):
   old,mode=before[path]
   if old is None:path.unlink(missing_ok=True)
   else:atomic(path,old,mode)
  restart(not args.final_only);print('VERIFIED_PEOPLE_UI_ROLLED_BACK',str(backup));raise
if __name__=='__main__':main()
