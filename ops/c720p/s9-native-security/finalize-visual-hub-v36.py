"""Guarded final V36 sources and sampled-count overlay; preserve review database."""
from pathlib import Path
import datetime,hashlib,json,py_compile,shutil,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');BIN=BASE/'bin';UI=Path('/opt/homeassistant/config/www/frontyard-security-new');ROOT=BASE/'state/s9-visual-attributes-v36'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main(stage):
 previous=json.loads((ROOT/'hub-release.json').read_text())
 for item in previous['files']:
  if sha(Path(item['path']))!=item['after_sha256']:raise RuntimeError('deployed_source_changed_refuse_overwrite')
 subprocess.run(['/usr/bin/python3',str(stage/'test-visual-review-v36.py')],check=True,timeout=30)
 changes={BIN/'s9_visual_review_v36.py':(stage/'s9_visual_review_v36.py').read_bytes(),UI/'visual-review-v36.js':(stage/'visual-review-v36.js').read_bytes()}
 for name in ('visual-review-v36.html','security-people-v33.html','face-appearances.html','security-tracks-v7.html'):changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 for path in (UI.parent/'c720p-surveillance.html',UI/'security-hub-v30.js'):
  body=path.read_text()
  if 'visual-review-v36-20261014' not in body:raise RuntimeError('security_cache_contract_changed')
  changes[path]=body.replace('visual-review-v36-20261014','visual-review-v36b-20261014').encode()
 changes[UI/'visual-review-entry-v36.js']=(stage/'visual-review-entry-v36.js').read_bytes()
 for name in ('security-archive-v7.html','security-review-v8.html','clips.html'):
  path=UI/name
  if path.exists():changes[path]=path.read_text().replace('visual-review-entry-v36.js?v=36','visual-review-entry-v36.js?v=36b').encode()
 proxy=BIN/'s9_sd_proxy_extension.py';body=proxy.read_text();marker='**detection_metrics(r)})'
 replacement='**detection_metrics(r),**s9_visual_review_v36.count_metrics(name,r)})'
 if body.count(marker)==1:body=body.replace(marker,replacement)
 elif body.count(replacement)!=1:raise RuntimeError('catalog_count_contract_changed')
 changes[proxy]=body.encode()
 backup=BASE/'backups/s9-visual-attributes-v36'/datetime.datetime.now(datetime.timezone.utc).strftime('final-%Y%m%dT%H%M%SZ');backup.mkdir(mode=0o700)
 saved=[]
 for i,path in enumerate(changes):
  copy=backup/str(i);shutil.copy2(path,copy);saved.append({'path':str(path),'backup':str(copy),'after_sha256':hashlib.sha256(changes[path]).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(saved,indent=2)+'\n')
 try:
  for path,raw in changes.items():
   temporary=path.with_name(path.name+'.final-v36');temporary.write_bytes(raw);shutil.copymode(path,temporary);temporary.replace(path)
  for path in (proxy,BIN/'s9_visual_review_v36.py'):py_compile.compile(str(path),doraise=True)
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=30)
  for _ in range(30):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?limit=1',timeout=3) as response:health=json.load(response)
    if health.get('ok'):break
   except Exception:time.sleep(.5)
  else:raise RuntimeError('updated_catalog_endpoint_unavailable')
  # Merge final exact hashes into the existing release receipt.
  updated={item['path']:item for item in previous['files']}
  updated.update({item['path']:item for item in saved});previous['files']=list(updated.values());previous['final_backup']=str(backup)
  (ROOT/'hub-release.json').write_text(json.dumps(previous,indent=2)+'\n')
  print(json.dumps({'ok':True,'final_backup':str(backup),'files':len(saved)}))
 except BaseException:
  for item in reversed(saved):shutil.copy2(item['backup'],item['path'])
  subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=30);raise
if __name__=='__main__':main(Path(sys.argv[1]))
