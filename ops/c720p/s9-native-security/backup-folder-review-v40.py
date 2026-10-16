"""Back up the complete current Security deployment and review state first."""
import datetime,hashlib,json,shutil,sqlite3
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');ROOT=BASE/'state/s9-visual-attributes-v36'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 release=json.loads((ROOT/'detection-hub-v39-release.json').read_text())
 # This unrelated Tracks page was independently replaced after V39. Preserve
 # its inspected live version; this People-only release must not overwrite it.
 overrides={'/opt/homeassistant/config/www/frontyard-security-new/security-tracks-v7.html':'6871e31e6ffd92d0d76fbd8745279c34051f44c74bf1b50387f144036c72f326'}
 for row in release['files']:assert sha(Path(row['path']))==overrides.get(row['path'],row['after_sha256']),'newer_live_source:'+row['path']
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=BASE/'backups/s9-folder-review-v40'/stamp;backup.mkdir(mode=0o700,parents=True)
 files=[]
 for i,row in enumerate(release['files']):
  source=Path(row['path']);copy=backup/str(i);shutil.copy2(source,copy);assert sha(source)==sha(copy)
  files.append({'path':str(source),'backup':str(copy),'sha256':sha(copy)})
 for name in ('catalog.json','detection-hub-v39-release.json','detection-pipeline-v39-verification.json'):
  shutil.copy2(ROOT/name,backup/name)
 with sqlite3.connect('file:'+str(ROOT/'review.sqlite3')+'?mode=ro',uri=True) as source:
  with sqlite3.connect(backup/'review.sqlite3') as dest:source.backup(dest)
  counts={t:source.execute('select count(*) from '+t).fetchone()[0] for t in ('folders','reviews','audit')}
 (backup/'review.sqlite3').chmod(0o600)
 manifest={'ok':True,'backup':str(backup),'files':files,'manual_state':counts,'database_sha256':sha(backup/'review.sqlite3'),'catalog_sha256':sha(backup/'catalog.json'),'original_media_untouched':True}
 (backup/'restore.json').write_text(json.dumps(manifest,indent=2));(ROOT/'folder-review-v40-backup.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
if __name__=='__main__':main()
