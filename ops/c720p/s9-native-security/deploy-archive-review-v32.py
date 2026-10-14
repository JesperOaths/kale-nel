"""Hub-only archive review deployment. Never labels or deletes real recordings."""
import argparse,datetime,hashlib,json,os,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');BIN=BASE/'bin';WWW=Path('/opt/homeassistant/config/www')
TARGETS={name:WWW/'frontyard-security-new'/name for name in ('archive-card-actions-v1.js','archive-review-v32.js','security-archive-v7.html','security-hub-v30.js','security-people-review-v32.html')}
TARGETS.update({'security-hub-v30.html':WWW/'c720p-surveillance.html','s9_archive_review_v32.py':BIN/'s9_archive_review_v32.py','s9_sd_proxy_extension.py':BIN/'s9_sd_proxy_extension.py','c720p-lan-camera-relay-v32.py':BIN/'c720p-lan-camera-relay.py'})
def sha(blob):return hashlib.sha256(blob).hexdigest() if blob is not None else None
def get(path,port=8794):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=25) as r:return json.load(r)
def atomic(path,blob,mode):
 fd,tmp=tempfile.mkstemp(prefix='.archive-review-v32-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(blob);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def restart():
 for unit in ('c720p-drive-security-archive.service','c720p-lan-camera-relay.service'):subprocess.run(['systemctl','--user','restart',unit],check=True,timeout=35)
def denied(path,headers,body,expected):
 request=urllib.request.Request('http://127.0.0.1:8794'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=20) as r:status=r.status
 except urllib.error.HTTPError as error:status=error.code;error.close()
 assert status==expected,(path,status,expected)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True,type=Path);args=parser.parse_args()
 manifest=json.loads((args.stage/'manifest.json').read_text());assert set(manifest)==set(TARGETS)
 before={};new={}
 for name,path in TARGETS.items():
  assert not path.is_symlink() and (not path.exists() or path.is_file())
  old=path.read_bytes() if path.exists() else None;blob=(args.stage/name).read_bytes()
  assert sha(old)==manifest[name]['before_sha256'],'concurrent_change_'+name
  assert sha(blob)==manifest[name]['sha256'],'stage_digest_'+name
  if name.endswith('.py'):compile(blob.decode(),name,'exec')
  before[path]=(old,path.stat().st_mode&0o777 if old is not None else (0o600 if name.endswith('.py') else 0o644));new[path]=blob
 subprocess.run(['systemctl','--user','is-active','c720p-agent-runner.service'],check=True,capture_output=True,timeout=10)
 saved=get('/new/api/saved');names={row['clip_no'] for row in saved['events']};assert names and saved.get('archive_mode')=='S9-microSD-only'
 camera_before=get('/status',18808)
 backup=BASE/'backups/archive-review-v32'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(parents=True,mode=0o700)
 restore={};written=[]
 for index,(path,(old,mode)) in enumerate(before.items()):
  copy=backup/(str(index)+'-'+path.name)
  if old is not None:copy.write_bytes(old);os.chmod(copy,0o600);assert copy.read_bytes()==old
  restore[str(path)]={'backup':str(copy) if old is not None else None,'mode':mode}
 (backup/'restore.json').write_text(json.dumps(restore,indent=2));os.chmod(backup/'restore.json',0o600)
 try:
  for path,blob in new.items():
   assert (path.read_bytes() if path.exists() else None)==before[path][0],'concurrent_write'
   atomic(path,blob,before[path][1]);written.append(path)
  restart();last=None
  for attempt in range(30):
   try:
    local=get('/new/api/archive-review?source=sd');drive=get('/new/api/archive-review?source=drive');folders=get('/new/api/person-folders');after=get('/new/api/saved')
    assert local['ok'] and drive['ok'] and local['source']=='sd' and drive['source']=='drive'
    assert local['workflow']=='awaiting_owner_done' and folders['matching_started'] is False and folders['profiles']==[]
    assert names.issubset({row['clip_no'] for row in after['events']})
    break
   except Exception as error:last=error;time.sleep(.5)
  else:raise last
  for name,path in TARGETS.items():
   if path.suffix not in ('.js','.html'):continue
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+str(path.relative_to(WWW))+'?v=archive-review-v32-20261014',timeout=20) as r:served=r.read(600000)
   assert sha(served)==sha(new[path]),'served_asset_mismatch_'+name
  # Negative writes only. No successful human decisions or media deletions here.
  origin={'Origin':'http://192.168.178.141:8123'};intent={'X-S9-Archive-Review-Intent':'human-recording-review-v32'}
  denied('/new/api/archive-review/batch',origin,{},403)
  denied('/new/api/archive-review/batch',{**intent,'Origin':'http://invalid.example'}, {},403)
  denied('/new/api/archive-review/batch',{**origin,**intent},{'items':[],'label':'person','human_confirmed':False},400)
  denied('/new/api/person-folders/review',{**origin,'X-S9-Person-Folder-Intent':'explicit-review-v31'}, {},423)
  for path in ('/new/api/sd/delete','/new/api/saved/delete'):denied(path,origin,{},403)
  camera_after=get('/status',18808)
  mode=camera_after.get('mode',camera_after.get('camera_mode'))
  assert mode in ('watching','recording'),'camera_not_healthy_'+str(mode)
  print(json.dumps({'installed':True,'matching_started':False,'workflow':local['workflow'],'recordings_before':len(names),'recordings_after':len(after['events']),'sd_reviewable':len(local['clips']),'drive_reviewable':len(drive['clips']),'verified_people_clips':local['verified_people_clips']+drive['verified_people_clips'],'negative_write_guards_passed':6,'camera_mode':mode,'camera_package_changed':False,'media_changed':False,'backup':str(backup)},sort_keys=True))
 except BaseException:
  for path in reversed(written):
   old,mode=before[path]
   if old is None:path.unlink(missing_ok=True)
   else:atomic(path,old,mode)
  restart();print('ARCHIVE_REVIEW_V32_ROLLED_BACK',str(backup));raise
if __name__=='__main__':main()
