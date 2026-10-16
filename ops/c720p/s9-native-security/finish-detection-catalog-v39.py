"""Keep comparison-set contents consistent with their unassigned counts."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');MODULE=BASE/'bin/s9_visual_review_v36.py';RECEIPT=BASE/'state/s9-visual-attributes-v36/detection-hub-v39-release.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def services():subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=50)
def main(stage):
 release=json.loads(RECEIPT.read_text())
 for row in release['files']:assert sha(Path(row['path']))==row['after_sha256'],'live_source_changed'
 subprocess.run(['python3',str(stage/'test-visual-review-v36.py')],check=True,timeout=35)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=BASE/'backups/s9-detection-review-v39'/('final-catalog-'+stamp);backup.mkdir(mode=0o700)
 old=backup/MODULE.name;shutil.copy2(MODULE,old);before=RECEIPT.read_bytes()
 try:
  temp=MODULE.with_name(MODULE.name+'.final-v39');shutil.copy2(stage/MODULE.name,temp);shutil.copymode(MODULE,temp);temp.replace(MODULE);services()
  for attempt in range(15):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?limit=1',timeout=15) as response:assert json.load(response)['ok']
    break
   except OSError:
    if attempt==14:raise
    time.sleep(1)
  row={'path':str(MODULE),'backup':str(old),'before_sha256':sha(old),'after_sha256':sha(MODULE)}
  (backup/'restore.json').write_text(json.dumps([row],indent=2))
  for i,item in enumerate(release['files']):
   if item['path']==str(MODULE):release['files'][i]=row;break
  else:raise AssertionError('receipt_missing_module')
  release['final_catalog_backup']=str(backup);RECEIPT.write_text(json.dumps(release,indent=2));print(json.dumps({'ok':True,'backup':str(backup)}))
 except BaseException:shutil.copy2(old,MODULE);RECEIPT.write_bytes(before);services();raise
if __name__=='__main__':main(Path(sys.argv[1]))
