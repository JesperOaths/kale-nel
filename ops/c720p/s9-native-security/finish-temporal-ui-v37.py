"""Apply the final evidence refinement and refresh every affected UI cache key."""
import hashlib,importlib.util,json,shutil,sys,datetime,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');WWW=Path('/opt/homeassistant/config/www');UI=WWW/'frontyard-security-new'
OLD='temporal-review-v37-20261015';NEW='temporal-review-v37a-20261015'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():assert sha(stage/name)==digest,'stage_changed'
 receipt=BASE/'state/s9-visual-attributes-v36/temporal-hub-v37-release.json';release=json.loads(receipt.read_text())
 for item in release['files']:assert sha(Path(item['path']))==item['after_sha256'],'newer_live_source:'+item['path']
 spec=importlib.util.spec_from_file_location('refine',stage/'refine-evidence-v37.py');refine=importlib.util.module_from_spec(spec);spec.loader.exec_module(refine)
 changes={}
 for name in ('visual-review-v36.js','visual-review-v36.html','visual-review-entry-v36.js','security-embedded-shell-v37.js'):changes[UI/name]=(stage/name).read_bytes()
 for name in ('security-people-v33.html','face-appearances.html','security-tracks-v7.html'):changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 for path in (WWW/'c720p-surveillance.html',UI/'security-hub-v30.html',UI/'security-hub-v30.js'):
  if path.exists():
   body=path.read_text();assert OLD in body,'entry_changed';changes[path]=body.replace(OLD,NEW).encode()
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  path=UI/name
  if not path.exists():continue
  body=path.read_text()
  if name=='security-review-v8.html':body=refine.patch(body)
  body=body.replace('security-embedded-shell-v37.js?v=37','security-embedded-shell-v37.js?v=37a').replace('visual-review-entry-v36.js?v=37','visual-review-entry-v36.js?v=37a')
  changes[path]=body.encode()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=BASE/'backups/s9-temporal-review-v37'/('final-'+stamp);backup.mkdir(parents=True,mode=0o700)
 saved=[]
 for i,path in enumerate(changes):
  copy=backup/str(i);shutil.copy2(path,copy);saved.append({'path':str(path),'backup':str(copy),'after_sha256':hashlib.sha256(changes[path]).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for path,raw in changes.items():
   temp=path.with_name(path.name+'.v37-final');temp.write_bytes(raw);shutil.copymode(path,temp);temp.replace(path)
  with urllib.request.urlopen('http://127.0.0.1:8123/local/frontyard-security-new/security-review-v8.html?v='+NEW,timeout=15) as response:html=response.read().decode()
  assert 'humanReviewV37' in html and 'Detector observations and sampled frames' in html
  prior={row['path']:row for row in release['files']};prior.update({row['path']:row for row in saved})
  release.update(files=list(prior.values()),final_backup=str(backup),ui_version=NEW,human_evidence_filters=True)
  receipt.write_text(json.dumps(release,indent=2))
  print(json.dumps({'ok':True,'files':len(saved),'backup':str(backup),'ui_version':NEW}),flush=True)
 except BaseException:
  for row in saved:shutil.copy2(row['backup'],row['path'])
  raise
if __name__=='__main__':main(Path(sys.argv[1]))
