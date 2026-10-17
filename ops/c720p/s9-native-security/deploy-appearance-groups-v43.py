"""Enable persistent provisional clothing-colour folders; never auto-approve a clip."""
import datetime,hashlib,json,shutil,sqlite3,subprocess,sys,time,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');UI=Path('/opt/homeassistant/config/www/frontyard-security-new');ROOT=BASE/'state/s9-visual-attributes-v36';BIN=BASE/'bin'
VERSION='appearance-folders-v43-20261017'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows():
 with sqlite3.connect('file:'+str(ROOT/'review.sqlite3')+'?mode=ro',uri=True) as c:
  return {name:sorted(hashlib.sha256(json.dumps(list(r),separators=(',',':')).encode()).hexdigest() for r in c.execute('SELECT * FROM '+name)) for name in ('folders','reviews','audit','folder_clips_v40','inbox_skips_v40')}
def get(port,path):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=30) as r:return json.load(r)
def restart():subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=50)
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text());assert all(sha(stage/n)==d for n,d in manifest.items()),'stage_changed'
 old=json.loads((ROOT/'folder-first-v42b-release.json').read_text());expected={**old['expected_assets'],**old['protected']}
 # A separately reviewed night-visibility script was added to the root entry.
 # Patch only its cache marker, retaining that exact concurrent addition.
 entry=UI.parent/'c720p-surveillance.html'
 if sha(entry)!=expected[str(entry)]:
  assert sha(entry)=='6f557886f52d4e1c501cc28d996a017f947b26ba8ee7976129fb842ea48ab3bf','unreviewed_root_change'
  assert b'<script id="s9-night-visibility-v1" src="/local/frontyard-security-new/s9-night-visibility-v1.js?v=422987f4d41a"></script>' in entry.read_bytes()
  expected[str(entry)]=sha(entry)
  visibility=UI/'s9-night-visibility-v1.js';expected[str(visibility)]=sha(visibility)
 assert all(sha(Path(p))==d for p,d in expected.items()),'concurrent_live_code_change'
 flag=ROOT/'appearance-groups-v43-enabled.json';module=BIN/'s9_appearance_groups_v43.py';assert not flag.exists() and not module.exists(),'already_enabled_or_unexpected_version'
 before=rows();catalog_sha=sha(ROOT/'catalog.json');phone=get(18808,'/status');policy=phone['motion_detector']
 changes={BIN/n:(stage/n).read_bytes() for n in ('s9_visual_review_v36.py','s9_folder_review_v40.py','s9_appearance_groups_v43.py')}
 changes[flag]=json.dumps({'enabled':True,'basis':'clothing_hsv_only','automatic_approvals':False}).encode()
 html=(stage/'people-folders-v42.html').read_bytes();changes[UI/'people-folders-v42.js']=(stage/'people-folders-v42.js').read_bytes()
 for n in ('people-folders-v42.html','people-folders-v40.html','face-appearances.html','security-people-v33.html'):changes[UI/n]=html
 for p in (UI/'security-hub-v30.html',UI.parent/'c720p-surveillance.html',UI/'security-hub-v30.js'):
  raw=p.read_bytes();assert b'folder-first-v42b-20261017' in raw;changes[p]=raw.replace(b'folder-first-v42b-20261017',VERSION.encode())
 p=UI/'visual-review-entry-v36.js';raw=p.read_bytes();assert raw.count(b'people-folders-v42.html?v=42b')==1;changes[p]=raw.replace(b'people-folders-v42.html?v=42b',b'people-folders-v42.html?v=43')
 for n in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  p=UI/n;raw=p.read_bytes();assert raw.count(b'visual-review-entry-v36.js?v=42b')==1;changes[p]=raw.replace(b'visual-review-entry-v36.js?v=42b',b'visual-review-entry-v36.js?v=43')
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');back=BASE/'backups/s9-appearance-groups-v43'/stamp;back.mkdir(mode=0o700,parents=True)
 with sqlite3.connect(ROOT/'review.sqlite3') as c,sqlite3.connect(back/'review.sqlite3') as d:c.backup(d)
 (back/'review.sqlite3').chmod(0o600);saved=[]
 for i,(p,raw) in enumerate(changes.items()):
  copy=back/str(i)
  if p.exists():shutil.copy2(p,copy)
  saved.append({'path':str(p),'backup':str(copy) if copy.exists() else None,'before_sha256':sha(copy) if copy.exists() else None,'after_sha256':hashlib.sha256(raw).hexdigest()})
 (back/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for p,raw in changes.items():
   tmp=p.with_name(p.name+'.43-stage');tmp.write_bytes(raw)
   if p.exists():shutil.copymode(p,tmp)
   else:tmp.chmod(0o600 if p==flag else 0o644)
   tmp.replace(p)
  restart()
  for i in range(20):
   try:report=get(8794,'/new/api/visual-review?workflow=clip_folders_v40&limit=100');break
   except OSError:
    if i==19:raise
    time.sleep(1)
  after=rows();checks={}
  assert set(before['folders'])<=set(after['folders']) and all(before[t]==after[t] for t in before if t!='folders');checks['all_existing_human_folders_and_decisions_preserved']=True
  assert sha(ROOT/'catalog.json')==catalog_sha;checks['catalog_unchanged']=True
  groups=[f for f in report['folders'] if f['automatic_appearance_group']];assert groups and all(f['approved_clips']==0 for f in groups)
  assert report['automatic_approvals'] is False and report['identity_matching'] is False;checks['automatic_folders_contain_unapproved_clips_only']=True
  ids={f['id'] for f in groups};sizes={f['id']:f['suggested_clips'] for f in groups}
  for port in (8794,8795):
   again=get(port,'/new/api/visual-review?workflow=clip_folders_v40&limit=100');assert {f['id'] for f in again['folders'] if f['automatic_appearance_group']}==ids
   for folder in ids:
    pending=get(port,'/new/api/visual-review?workflow=clip_folders_v40&tab=suggestions&folder='+folder);assert pending['total']==sizes[folder] and all(not i.get('decision') for i in pending['items'])
  assert rows()==after;checks['groups_are_persistent_and_read_refresh_does_not_approve']=True
  assert all(sha(Path(p))==d for p,d in expected.items() if Path(p) not in changes);checks['unrelated_code_preserved']=True
  assert all(sha(Path(r['path']))==r['after_sha256'] for r in saved);checks['deployed_assets_match_release']=True
  with urllib.request.urlopen('http://127.0.0.1:8123/local/frontyard-security-new/security-people-v33.html?v=43',timeout=25) as response:assert response.read()==html
  checks['home_assistant_serves_new_ui']=True
  camera=get(18808,'/status');assert camera['motion_detector']==policy and camera['sensor_result_fps']>28 and camera['continuous_4k_dropped_output_frames']==0;checks['recorder_healthy_and_untouched']=True
  result={'ok':True,'version':VERSION,'backup':str(back),'files':saved,'protected':{p:d for p,d in expected.items() if Path(p) not in changes},'manual_rows_before':before,'checks':checks,'groups':len(groups),'pending_group_sizes':sorted(sizes.values(),reverse=True),'automatic_approvals':0,'identity_matching':False,'camera_policy':policy}
  (ROOT/'appearance-groups-v43-release.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('files','protected','manual_rows_before')}),flush=True)
 except BaseException:
  for r in saved:
   p=Path(r['path'])
   if r['backup']:shutil.copy2(r['backup'],p)
   elif p.exists() and sha(p)==r['after_sha256']:p.unlink()
  # Keep metadata/SQLite: never erase a human decision made during deployment.
  restart();raise
if __name__=='__main__':main(Path(sys.argv[1]))
