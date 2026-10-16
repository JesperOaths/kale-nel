"""Replace People UI after a verified backup; do not touch recorder or Tracks."""
from pathlib import Path
import datetime,hashlib,json,shutil,sqlite3,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');ROOT=BASE/'state/s9-visual-attributes-v36';UI=Path('/opt/homeassistant/config/www/frontyard-security-new');BIN=BASE/'bin'
VERSION='manual-folders-v40a-20261016'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=60).stdout
def legacy_digest(path):
 with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as c:
  result={table:c.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall() for table in ('folders','reviews','audit','revision')}
 return hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():assert sha(stage/name)==digest,'stage_changed:'+name
 backup=json.loads((ROOT/'folder-review-v40-backup.json').read_text());assert backup['ok']
 for row in backup['files']:assert sha(Path(row['path']))==row['sha256'],'live_source_changed:'+row['path']
 assert sha(Path(backup['backup'])/'review.sqlite3')==backup['database_sha256']
 for script in ('test-visual-review-v36.py','test-folder-review-v40.py'):print(run(['python3',str(stage/script)]),flush=True)
 changes={BIN/name:(stage/name).read_bytes() for name in ('s9_visual_review_v36.py','s9_folder_review_v40.py')}
 for name in ('people-folders-v40.html','people-folders-v40.js','visual-review-entry-v36.js','security-hub-v30.html','security-hub-v30.js'):changes[UI/name]=(stage/name).read_bytes()
 for name in ('face-appearances.html','security-people-v33.html'):changes[UI/name]=(stage/'people-folders-v40.html').read_bytes()
 changes[UI.parent/'c720p-surveillance.html']=(stage/'security-hub-v30.html').read_bytes()
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  path=UI/name
  if path.exists():changes[path]=path.read_bytes().replace(b'visual-review-entry-v36.js?v=39',b'visual-review-entry-v36.js?v=40')
 expected={row['path']:row for row in backup['files']}
 for p in changes:
  if str(p) not in expected:assert not p.exists(),'new_file_already_exists:'+str(p)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');deploy_backup=Path(backup['backup'])/('deployment-'+stamp);deploy_backup.mkdir(mode=0o700)
 saved=[]
 for i,(p,raw) in enumerate(changes.items()):
  copy=deploy_backup/str(i)
  if p.exists():shutil.copy2(p,copy)
  saved.append({'path':str(p),'backup':str(copy) if copy.exists() else None,'after_sha256':hashlib.sha256(raw).hexdigest()})
 with sqlite3.connect(ROOT/'review.sqlite3') as source:
  with sqlite3.connect(deploy_backup/'review.sqlite3') as target:source.backup(target)
 (deploy_backup/'review.sqlite3').chmod(0o600);(deploy_backup/'restore.json').write_text(json.dumps(saved,indent=2));before=legacy_digest(ROOT/'review.sqlite3')
 try:
  for p,raw in changes.items():
   temp=p.with_name(p.name+'.v40-stage');temp.write_bytes(raw)
   shutil.copymode(p,temp) if p.exists() else temp.chmod(0o644)
   temp.replace(p)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'])
  for attempt in range(20):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?workflow=clip_folders_v40',timeout=15) as r:report=json.load(r)
    assert report['ok'] and report['identity_matching'] is False and report['auto_assignments'] is False;break
   except OSError:
    if attempt==19:raise
    time.sleep(1)
  assert legacy_digest(ROOT/'review.sqlite3')==before,'manual_records_changed'
  rows={row['path']:{'path':row['path'],'backup':row['backup'],'after_sha256':row['sha256']} for row in backup['files']};rows.update({row['path']:row for row in saved})
  assert all(sha(Path(row['path']))==row['after_sha256'] for row in rows.values()),'deployed_source_changed'
  receipt={'ok':True,'ui_version':VERSION,'backup':backup['backup'],'deployment_backup':str(deploy_backup),'files':list(rows.values()),'manual_digest':before,
   'identity_matching':False,'auto_assignments':False,'inbox_clips':report['inbox_clips'],'folders':len(report['folders']),'recorder_unchanged':True}
  (ROOT/'folder-review-v40-release.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({k:v for k,v in receipt.items() if k!='files'}),flush=True)
 except BaseException:
  for row in saved:
   if row['backup']:shutil.copy2(row['backup'],row['path'])
   else:Path(row['path']).unlink(missing_ok=True)
  # Keep the current database: user approvals made after the backup must not
  # be overwritten. Old code safely ignores the additive V40 tables.
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service']);raise
if __name__=='__main__':main(Path(sys.argv[1]))
