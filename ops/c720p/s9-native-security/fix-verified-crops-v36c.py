"""Guarded hub-only correction: owner verification, crop review, status v9."""
import contextlib, datetime, hashlib, json, os, py_compile, shutil, sqlite3
import subprocess, sys, time, urllib.request
from pathlib import Path

BASE=Path('/home/jespern/c720p-home-hub')
BIN=BASE/'bin'
WWW=Path('/opt/homeassistant/config/www')
UI=WWW/'frontyard-security-new'
OLD='visual-review-v36b-20261014'
NEW='verified-crops-v36c-20261015'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(args,timeout=30):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=timeout).stdout
def get(path):
 with urllib.request.urlopen('http://127.0.0.1:8794'+path,timeout=12) as response:return json.load(response)

def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest['sources'].items():
  if sha(stage/name)!=digest:raise RuntimeError('staged_source_changed:'+name)
 for name,digest in manifest['guards'].items():
  if sha(Path(name))!=digest:raise RuntimeError('live_source_changed:'+name)
 run(['systemctl','--user','is-active','c720p-agent-runner.service'])
 run(['/usr/bin/python3',str(stage/'test-visual-review-v36.py')])
 for name in ('s9_visual_review_v36.py','s9_phone_garden_status.py'):py_compile.compile(str(stage/name),doraise=True)
 before=get('/new/api/visual-review?limit=1')
 archive=get('/new/api/archive-review?source=sd')
 if not before.get('ok') or not archive.get('ok'):raise RuntimeError('catalog_unavailable_before_change')
 changes={BIN/name:(stage/name).read_bytes() for name in ('s9_visual_review_v36.py','s9_phone_garden_status.py')}
 changes.update({UI/name:(stage/name).read_bytes() for name in ('visual-review-v36.html','visual-review-v36.js')})
 for name in ('security-people-v33.html','face-appearances.html','security-tracks-v7.html'):
  if sha(UI/name)!=manifest['guards'][str(UI/'visual-review-v36.html')]:raise RuntimeError('review_alias_changed:'+name)
  changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 for path in (WWW/'c720p-surveillance.html',UI/'security-hub-v30.html',UI/'security-hub-v30.js'):
  if not path.exists() and path.name=='security-hub-v30.html':continue
  body=path.read_text()
  if OLD not in body and NEW not in body:raise RuntimeError('entry_version_changed:'+str(path))
  changes[path]=body.replace(OLD,NEW).encode()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=BASE/'backups/s9-visual-attributes-v36'/('verified-crops-'+stamp);backup.mkdir(parents=True,mode=0o700)
 saved=[]
 for number,path in enumerate(changes):
  copy=backup/str(number);shutil.copy2(path,copy)
  saved.append({'path':str(path),'backup':str(copy),'before_sha256':sha(path),'after_sha256':hashlib.sha256(changes[path]).hexdigest()})
 with contextlib.closing(sqlite3.connect(BASE/'state/s9-visual-attributes-v36/review.sqlite3')) as source:
  with contextlib.closing(sqlite3.connect(backup/'review.sqlite3')) as destination:source.backup(destination)
 os.chmod(backup/'review.sqlite3',0o600)
 (backup/'restore.json').write_text(json.dumps(saved,indent=2))
 services=['c720p-drive-security-archive.service','c720p-lan-camera-relay.service']
 try:
  for path,raw in changes.items():
   temp=path.with_name(path.name+'.v36c-stage');temp.write_bytes(raw);shutil.copymode(path,temp);temp.replace(path)
  run(['systemctl','--user','restart',*services])
  for _ in range(20):
   try:
    after=get('/new/api/visual-review?limit=1')
    health=get('/new/api/live-person-watch')
    if after.get('ok') and health.get('ok'):break
   except (OSError,ValueError):pass
   time.sleep(.5)
  else:raise RuntimeError('live_catalog_or_status_failed')
  assert after['verification_gate']=='current_archive_person_or_people'
  assert health['camera_mode'] in ('watching','recording')
  assert health['detector_version']=='person_spatiotemporal_transport_v9'
  # All currently returned candidates must have a matching positive owner label.
  all_rows=get('/new/api/visual-review?limit=200&presence=all')
  for item in all_rows['items']:
   assert archive['clips'][item['clip']]['label'] in ('person','people')
  for item in saved:assert sha(Path(item['path']))==item['after_sha256']
  receipt={'ok':True,'backup':str(backup),'files':saved,'before_views':before['total'],
   'after_views':after['total'],'eligible_4k_clips':after['eligible_clips'],
   'indexed_4k_clips':after['indexed_clips'],'archive_verified_sd_clips':archive['verified_people_clips'],
   'camera_mode':health['camera_mode'],'sensor_fps':health['camera_sensor']['fps'],
   'detector_version':health['detector_version'],'human_labels_changed':False,
   'phone_package_changed':False,'deployed_at':stamp,'ha_entry_refresh_pending':OLD in (WWW/'c720p-surveillance.html').read_text()}
  (BASE/'state/s9-visual-attributes-v36/verified-crops-v36c-release.json').write_text(json.dumps(receipt,indent=2))
  print(json.dumps({k:v for k,v in receipt.items() if k!='files'}),flush=True)
 except BaseException:
  for item in reversed(saved):shutil.copy2(item['backup'],item['path'])
  run(['systemctl','--user','restart',*services]);raise

if __name__=='__main__':main(Path(sys.argv[1]))
