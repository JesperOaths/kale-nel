"""Install the browser-verified decision-first layout without touching review data."""
from pathlib import Path
import datetime,hashlib,json,shutil,sys
BASE=Path('/home/jespern/c720p-home-hub');ROOT=BASE/'state/s9-visual-attributes-v36';UI=Path('/opt/homeassistant/config/www/frontyard-security-new')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main(stage):
 receipt=ROOT/'folder-review-v40-release.json';release=json.loads(receipt.read_text());assert release['ui_version']=='manual-folders-v40-20261016'
 for row in release['files']:assert sha(Path(row['path']))==row['after_sha256'],'live_source_changed:'+row['path']
 changes={UI/name:(stage/name).read_bytes() for name in ('people-folders-v40.html','people-folders-v40.js','security-hub-v30.html','security-hub-v30.js','visual-review-entry-v36.js')}
 for name in ('security-people-v33.html','face-appearances.html'):changes[UI/name]=(stage/'people-folders-v40.html').read_bytes()
 changes[UI.parent/'c720p-surveillance.html']=(stage/'security-hub-v30.html').read_bytes()
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  path=UI/name
  if path.exists():changes[path]=path.read_bytes().replace(b'visual-review-entry-v36.js?v=40',b'visual-review-entry-v36.js?v=40a')
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=Path(release['backup'])/('final-ui-'+stamp);backup.mkdir(mode=0o700)
 rows=[]
 for i,(path,raw) in enumerate(changes.items()):
  saved=backup/str(i);shutil.copy2(path,saved);rows.append({'path':str(path),'backup':str(saved),'after_sha256':hashlib.sha256(raw).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(rows,indent=2))
 try:
  for path,raw in changes.items():
   temp=path.with_name(path.name+'.v40-final');temp.write_bytes(raw);shutil.copymode(path,temp);temp.replace(path)
  combined={r['path']:r for r in release['files']};combined.update({r['path']:r for r in rows});release.update(files=list(combined.values()),ui_version='manual-folders-v40a-20261016',final_ui_backup=str(backup))
  receipt.write_text(json.dumps(release,indent=2));print(json.dumps({'ok':True,'backup':str(backup),'ui_version':release['ui_version']}))
 except BaseException:
  for row in rows:shutil.copy2(row['backup'],row['path'])
  raise
if __name__=='__main__':main(Path(sys.argv[1]))
