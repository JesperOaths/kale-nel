"""Version-guarded best-fit activation on the existing approved dataset only."""
import argparse,hashlib,importlib,json,os,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');WWW=Path('/opt/homeassistant/config/www');STATE=BASE/'state/s9-verified-people-v33'
TARGETS={name:BASE/'bin'/name for name in ('s9_verified_people_v33.py','s9_best_fit_people_v34.py')}
TARGETS.update({name:WWW/'frontyard-security-new'/name for name in ('security-people-v33.html','security-people-v33.js','security-hub-v30.js')})
TARGETS['security-hub-v30.html']=WWW/'c720p-surveillance.html'
def sha(blob):return hashlib.sha256(blob).hexdigest() if blob is not None else None
def get(path,port=8794):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=30) as response:return json.load(response)
def atomic(path,blob,mode):
 fd,temp=tempfile.mkstemp(dir=path.parent,prefix='.best-fit-v34-')
 try:
  with os.fdopen(fd,'wb') as out:out.write(blob);out.flush();os.fsync(out.fileno())
  os.chmod(temp,mode);os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True,type=Path);stage=parser.parse_args().stage;manifest=json.loads((stage/'manifest.json').read_text());assert set(manifest)==set(TARGETS)
 sys.path.insert(0,str(BASE/'bin'))
 import s9_verified_people_v33 as people
 import s9_sd_proxy_extension as proxy
 import s9_archive_delete_v1 as deletion
 people.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
 preview=people.read('best-fit-preview-v34.json');assert preview and preview['algorithm_sha256']==manifest['s9_best_fit_people_v34.py']['sha256']
 def unchanged():
  assert sha((STATE/'features.json').read_bytes())==preview['features_sha256'],'features_changed_since_trial'
  assert sha(json.dumps(people.allowed(),sort_keys=True).encode())==preview['approved_sha256'],'verification_changed_since_trial'
 unchanged();before={};new={}
 for name,path in TARGETS.items():
  assert not path.is_symlink();old=path.read_bytes() if path.exists() else None;blob=(stage/name).read_bytes()
  assert sha(old)==manifest[name]['before_sha256'],'unexpected_live_version_'+name
  assert sha(blob)==manifest[name]['sha256'],'stage_digest_'+name
  if name.endswith('.py'):compile(blob.decode(),name,'exec')
  before[path]=(old,path.stat().st_mode&0o777 if path.exists() else 0o600);new[path]=blob
 subprocess.run(['systemctl','--user','is-active','c720p-agent-runner.service'],check=True,capture_output=True,timeout=10)
 assert get('/status',18808)['mode'] in ('watching','recording')
 from datetime import datetime,timezone
 backup=BASE/'backups/best-fit-people-v34'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(parents=True,mode=0o700);restore={}
 for index,(path,(blob,mode)) in enumerate(before.items()):
  saved=backup/(str(index)+'-'+path.name)
  if blob is not None:saved.write_bytes(blob);os.chmod(saved,0o600)
  restore[str(path)]={'backup':str(saved) if blob is not None else None,'mode':mode}
 atomic(backup/'restore.json',json.dumps(restore,indent=2).encode(),0o600)
 policy=STATE/'grouping-policy.json';old_policy=policy.read_bytes() if policy.exists() else None;new_policy=None;receipt={};written=[]
 if old_policy is not None:atomic(backup/'grouping-policy-before.json',old_policy,0o600)
 try:
  for path,blob in new.items():
   assert (path.read_bytes() if path.exists() else None)==before[path][0],'concurrent_source_change'
   atomic(path,blob,before[path][1]);written.append(path)
  importlib.invalidate_caches();people=importlib.reload(people);people.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
  unchanged();people.write('grouping-policy.json',{'algorithm':'verified_multiview_best_fit_v34','owner_request':'group_sightings_into_best_fit_person_folders','activated_at':people.utc(),'approved_sha256':preview['approved_sha256']});new_policy=policy.read_bytes()
  people.reconcile_registry(preview['result']['comparisons'],receipt)
  tracks=people.tracks_now();registry=people.read('registry.json');assert set(tracks)<=set(registry['links'])
  for pid in registry['profiles']:
   members=[tracks[k] for k,v in registry['links'].items() if v==pid and k in tracks]
   # Existing human-reviewed folders are preserved; this task never combines simultaneous views.
   assert all(not people.conflict(a,b) for i,a in enumerate(members) for b in members[i+1:])
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],check=True,timeout=35)
  for attempt in range(40):
   try:
    ready=get('/new/api/verified-people')
    assert ready['ok'] and sum(f['appearances'] for f in ready['folders'])==len(tracks)
    break
   except (OSError,ValueError,AssertionError):time.sleep(.5)
  else:raise RuntimeError('archive_did_not_become_ready')
  subprocess.run(['/usr/bin/python3',str(BASE/'bin/verify-people-live-v33.py')],check=True,timeout=120)
  data=get('/new/api/verified-people');assert data['ok'] and data['processed_clips']==len(people.allowed())
  assert sum(f['appearances'] for f in data['folders'])==len(tracks)
  for path,blob in new.items():
   if path.suffix not in ('.js','.html'):continue
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+str(path.relative_to(WWW))+'?v=best-fit-people-v34-20261014',timeout=20) as response:assert sha(response.read(600000))==sha(blob)
  assert get('/status',18808)['mode'] in ('watching','recording')
  result={'installed':True,'source_files':len(new),'approved_clips':data['approved_clips'],'sightings':len(tracks),'folders':len(data['folders']),'multi_recording_folders':sum(f['recordings']>1 for f in data['folders']),'tentative_appearances':sum(f['tentative_appearances'] for f in data['folders']),'grouping':registry.get('grouping'),'backup':str(backup),'registry_rollback':receipt}
  people.write('best-fit-release-v34.json',result);people.audit({'action':'best_fit_v34_activated','folders':result['folders'],'backup':str(backup)});print(json.dumps(result,sort_keys=True))
 except BaseException:
  with people.registry_lock():
   if receipt and sha((STATE/'registry.json').read_bytes())==receipt['after_sha256']:atomic(STATE/'registry.json',(STATE/receipt['backup']).read_bytes(),0o600)
   if new_policy is not None and policy.read_bytes()==new_policy:
    if old_policy is None:policy.unlink()
    else:atomic(policy,old_policy,0o600)
  for path in reversed(written):
   if path.read_bytes()!=new[path]:continue
   old,mode=before[path]
   if old is None:path.unlink()
   else:atomic(path,old,mode)
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],check=True,timeout=35)
  print('BEST_FIT_V34_ROLLED_BACK',str(backup));raise
if __name__=='__main__':main()
