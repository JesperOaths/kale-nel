"""Apply the browser-verified compact overview against the deployed receipt."""
import datetime,hashlib,json,shutil,sys
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');UI=Path('/opt/homeassistant/config/www/frontyard-security-new')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main(stage):
 receipt=BASE/'state/s9-visual-attributes-v36/detection-hub-v39-release.json';release=json.loads(receipt.read_text())
 for row in release['files']:assert sha(Path(row['path']))==row['after_sha256'],'live_source_changed'
 raw=(stage/'visual-review-v36.html').read_bytes();assert b'savedFolderHome' in raw
 changes={UI/name:raw for name in ('visual-review-v36.html','security-people-v33.html','face-appearances.html','security-tracks-v7.html')}
 for name in ('visual-review-v36.js','security-hub-v30.html','security-hub-v30.js'):changes[UI/name]=(stage/name).read_bytes()
 changes[UI.parent/'c720p-surveillance.html']=(stage/'security-hub-v30.html').read_bytes()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=BASE/'backups/s9-detection-review-v39'/('final-ui-'+stamp);backup.mkdir(mode=0o700)
 saved=[]
 for i,(path,content) in enumerate(changes.items()):
  b=backup/str(i);shutil.copy2(path,b);saved.append({'path':str(path),'backup':str(b),'before_sha256':sha(b),'after_sha256':hashlib.sha256(content).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for row in saved:
   path=Path(row['path']);tmp=path.with_name(path.name+'.final-v39');tmp.write_bytes(changes[path]);shutil.copymode(path,tmp);tmp.replace(path)
  rows={row['path']:row for row in release['files']};rows.update({row['path']:row for row in saved});release['files']=list(rows.values());release['final_ui_backup']=str(backup);release['ui_version']='detection-review-v39b-20261016'
  receipt.write_text(json.dumps(release,indent=2));print(json.dumps({'ok':True,'backup':str(backup)}))
 except BaseException:
  for row in saved:shutil.copy2(row['backup'],row['path'])
  raise
if __name__=='__main__':main(Path(sys.argv[1]))
