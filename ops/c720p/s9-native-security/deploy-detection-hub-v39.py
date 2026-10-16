"""Guarded V38 catalog/scroll/review deployment; retain media and manual state."""
import datetime,hashlib,json,shutil,sqlite3,subprocess,sys,time,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');UI=Path('/opt/homeassistant/config/www/frontyard-security-new');BIN=BASE/'bin'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=65).stdout
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():assert sha(stage/name)==digest,'stage_changed:'+name
 prior=json.loads((BASE/'state/s9-visual-attributes-v36/detection-hub-v38-release.json').read_text())
 for item in prior['files']:assert sha(Path(item['path']))==item['after_sha256'],'newer_live_source:'+item['path']
 assert 'detection-review-v38-20261016' in (UI/'security-hub-v30.js').read_text(),'live_version_changed'
 run(['python3',str(stage/'test-visual-review-v36.py')])
 changes={BIN/name:(stage/name).read_bytes() for name in ('s9_visual_review_v36.py','s9_phone_garden_status.py')}
 for name in ('security-hub-v30.html','security-hub-v30.js','security-hub-v30.css','visual-review-v36.html','visual-review-v36.js','visual-review-entry-v36.js'):
  changes[UI/name]=(stage/name).read_bytes()
 for name in ('security-people-v33.html','face-appearances.html','security-tracks-v7.html'):changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 changes[UI.parent/'c720p-surveillance.html']=(stage/'security-hub-v30.html').read_bytes()
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  p=UI/name
  if p.exists():changes[p]=p.read_bytes().replace(b'visual-review-entry-v36.js?v=38',b'visual-review-entry-v36.js?v=39')
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=BASE/'backups/s9-detection-review-v39'/stamp;backup.mkdir(parents=True,mode=0o700)
 saved=[]
 for i,(p,raw) in enumerate(changes.items()):
  b=backup/str(i)
  if p.exists():shutil.copy2(p,b)
  saved.append({'path':str(p),'backup':str(b) if b.exists() else None,'before_sha256':sha(b) if b.exists() else None,'after_sha256':hashlib.sha256(raw).hexdigest()})
 with sqlite3.connect(BASE/'state/s9-visual-attributes-v36/review.sqlite3') as source:
  with sqlite3.connect(backup/'review.sqlite3') as dest:source.backup(dest)
 (backup/'review.sqlite3').chmod(0o600);(backup/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for p,raw in changes.items():
   tmp=p.with_name(p.name+'.v38-stage');tmp.write_bytes(raw)
   shutil.copymode(p,tmp) if p.exists() else tmp.chmod(0o644)
   tmp.replace(p)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'])
  for attempt in range(15):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?limit=1',timeout=20) as response:report=json.load(response)
    break
   except OSError:
    if attempt==14:raise
    time.sleep(1)
  assert report['ok'] and report['organization']=='manual_only' and 'coverage' in report and 'attribute_sets' in report
  with urllib.request.urlopen('http://127.0.0.1:8123/local/c720p-surveillance.html?v=detection-review-v39b-20261016',timeout=15) as response:assert b'liveDiagnostics' in response.read()
  receipt={'ok':True,'backup':str(backup),'files':saved,'ui_version':'detection-review-v39b-20261016','coverage':report['coverage'],'attribute_sets':len(report['attribute_sets']),'identity_matching':False}
  (BASE/'state/s9-visual-attributes-v36/detection-hub-v39-release.json').write_text(json.dumps(receipt,indent=2))
  print(json.dumps({k:v for k,v in receipt.items() if k!='files'}),flush=True)
 except BaseException:
  for row in saved:
   if row['backup']:shutil.copy2(row['backup'],row['path'])
   else:Path(row['path']).unlink(missing_ok=True)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service']);raise
if __name__=='__main__':main(Path(sys.argv[1]))
