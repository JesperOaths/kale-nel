"""Add explicitly scoped manual assignment browsing; preserve all human decisions."""
import hashlib,json,shutil,sqlite3,subprocess,sys,time,datetime,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');UI=Path('/opt/homeassistant/config/www/frontyard-security-new');ROOT=BASE/'state/s9-visual-attributes-v36'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get(port,path):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=25) as r:return json.load(r)
def rows():
 with sqlite3.connect('file:'+str(ROOT/'review.sqlite3')+'?mode=ro',uri=True) as c:
  return {name:sorted(hashlib.sha256(json.dumps(list(r),separators=(',',':')).encode()).hexdigest() for r in c.execute('SELECT * FROM '+name)) for name in ('folders','reviews','audit','revision','folder_clips_v40','inbox_skips_v40')}
def restart():subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=50)
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 assert all(sha(stage/name)==digest for name,digest in manifest.items()),'stage_changed'
 previous=json.loads((ROOT/'folder-first-v42-release.json').read_text());assert previous['version']=='folder-first-v42-20261017'
 expected={r['path']:r['after_sha256'] for r in previous['files']};protected=previous['protected'];assert all(sha(Path(p))==digest for p,digest in {**expected,**protected}.items()),'concurrent_change'
 backend=BASE/'bin/s9_folder_review_v40.py';changes={backend:(stage/backend.name).read_bytes(),UI/'people-folders-v42.js':(stage/'people-folders-v42.js').read_bytes()}
 html=(stage/'people-folders-v42.html').read_bytes()
 for name in ('people-folders-v42.html','people-folders-v40.html','face-appearances.html','security-people-v33.html'):changes[UI/name]=html
 for p in (UI/'security-hub-v30.html',UI.parent/'c720p-surveillance.html',UI/'security-hub-v30.js'):
  raw=p.read_bytes();assert b'folder-first-v42-20261017' in raw;changes[p]=raw.replace(b'folder-first-v42-20261017',b'folder-first-v42b-20261017')
 p=UI/'visual-review-entry-v36.js';raw=p.read_bytes();assert raw.count(b'people-folders-v42.html?v=42')==1;changes[p]=raw.replace(b'people-folders-v42.html?v=42',b'people-folders-v42.html?v=42b')
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  p=UI/name;raw=p.read_bytes();assert raw.count(b'visual-review-entry-v36.js?v=42')==1;changes[p]=raw.replace(b'visual-review-entry-v36.js?v=42',b'visual-review-entry-v36.js?v=42b')
 before=rows();catalog_sha=sha(ROOT/'catalog.json');detector=get(18808,'/status')['motion_detector'];stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');back=BASE/'backups/s9-folder-first-v42'/('scoped-assign-'+stamp);back.mkdir(mode=0o700,parents=True)
 saved=[]
 for i,(p,raw) in enumerate(changes.items()):
  copy=back/str(i);shutil.copy2(p,copy);saved.append({'path':str(p),'backup':str(copy),'before_sha256':sha(copy),'after_sha256':hashlib.sha256(raw).hexdigest()})
 with sqlite3.connect(ROOT/'review.sqlite3') as c,sqlite3.connect(back/'review.sqlite3') as d:c.backup(d)
 (back/'review.sqlite3').chmod(0o600);(back/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for p,raw in changes.items():
   tmp=p.with_name(p.name+'.42b-stage');tmp.write_bytes(raw);shutil.copymode(p,tmp);tmp.replace(p)
  restart()
  for i in range(15):
   try:report=get(8794,'/new/api/visual-review?workflow=clip_folders_v40&tab=inbox&limit=100');break
   except OSError:
    if i==14:raise
    time.sleep(1)
  checks={}
  assert rows()==before;checks['all_existing_manual_decisions_preserved']=True
  assert sha(ROOT/'catalog.json')==catalog_sha;checks['catalog_preserved']=True
  assert all(sha(Path(p))==digest for p,digest in protected.items() if Path(p)!=backend);checks['other_backend_tracks_and_camera_adapter_preserved']=True
  for port in (8794,8795):
   r=get(port,'/new/api/visual-review?workflow=clip_folders_v40&tab=inbox&limit=100');assert r['ok'] and not r['identity_matching'] and not r['auto_assignments']
   for f in r['folders']:
    scoped=get(port,'/new/api/visual-review?workflow=clip_folders_v40&tab=assign&folder='+f['id']);assert scoped['ok'] and scoped['folder']==f['id'] and len({i['clip'] for i in scoped['items']})==len(scoped['items'])
   status=get(port,'/new/api/live-person-watch');assert status['ok'] and status['detector_version']==detector
  checks['both_ports_support_folder_scoped_manual_assignment']=True
  expected.update({r['path']:r['after_sha256'] for r in saved});assert all(sha(Path(p))==digest for p,digest in expected.items());checks['all_deployed_source_hashes_match']=True
  for name in ('people-folders-v42.html','people-folders-v40.html','face-appearances.html','security-people-v33.html'):
   with urllib.request.urlopen('http://127.0.0.1:8123/local/frontyard-security-new/'+name+'?v=42b',timeout=25) as response:assert response.read()==html
  checks['home_assistant_aliases_serve_final_page']=True
  phone=get(18808,'/status');assert phone['motion_detector']==detector and phone['sensor_result_fps']>28 and phone['continuous_4k_dropped_output_frames']==0;checks['camera_healthy_and_existing_policy_preserved']=True
  protected[str(backend)]=sha(backend)
  result={'ok':True,'version':'folder-first-v42b-20261017','backup':str(back),'previous_backup':previous['backup'],'files':saved,'expected_assets':expected,'protected':protected,'manual_rows':before,'checks':checks,'folder_count':len(report['folders']),'verified_clips':report['coverage']['verified_clips'],'identity_matching':False,'auto_assignments':False,'detector':detector}
  (ROOT/'folder-first-v42b-release.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('files','expected_assets','protected','manual_rows')}),flush=True)
 except BaseException:
  for r in saved:shutil.copy2(r['backup'],r['path'])
  restart();raise
if __name__=='__main__':main(Path(sys.argv[1]))
