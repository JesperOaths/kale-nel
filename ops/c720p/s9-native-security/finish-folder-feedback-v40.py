"""Make a later approval replace an inbox rejection, preserving all records."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');ROOT=BASE/'state/s9-visual-attributes-v36';MODULE=BASE/'bin/s9_folder_review_v40.py'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def services():subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=55)
def main(stage):
 receipt=ROOT/'folder-review-v40-release.json';release=json.loads(receipt.read_text())
 for row in release['files']:assert sha(Path(row['path']))==row['after_sha256'],'live_source_changed'
 subprocess.run(['python3',str(stage/'test-folder-review-v40.py')],check=True,timeout=45)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=Path(release['backup'])/('feedback-'+stamp);backup.mkdir(mode=0o700);saved=backup/MODULE.name;shutil.copy2(MODULE,saved)
 try:
  temp=MODULE.with_name(MODULE.name+'.feedback-v40');shutil.copy2(stage/MODULE.name,temp);shutil.copymode(MODULE,temp);temp.replace(MODULE);services()
  for port in (8794,8795):
   for attempt in range(20):
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}/new/api/visual-review?workflow=clip_folders_v40',timeout=15) as r:assert json.load(r)['ok']
     break
    except OSError:
     if attempt==19:raise
     time.sleep(1)
  row={'path':str(MODULE),'backup':str(saved),'after_sha256':sha(MODULE)};(backup/'restore.json').write_text(json.dumps([row],indent=2))
  for i,old in enumerate(release['files']):
   if old['path']==str(MODULE):release['files'][i]=row;break
  release['feedback_backup']=str(backup);receipt.write_text(json.dumps(release,indent=2));print(json.dumps({'ok':True,'backup':str(backup)}))
 except BaseException:shutil.copy2(saved,MODULE);services();raise
if __name__=='__main__':main(Path(sys.argv[1]))
