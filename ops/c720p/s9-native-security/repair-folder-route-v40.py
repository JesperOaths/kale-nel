"""Mount review routes in the durable playback initializer, keeping auth mode."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');ROOT=BASE/'state/s9-visual-attributes-v36';BIN=BASE/'bin'
EXPECTED='b4769da1d93c3e9275bf3cc29ebda1742e0d2ba2548b27000a2ba6d064b42d0d'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def services():subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=55)
def main(stage):
 receipt=ROOT/'folder-review-v40-release.json';release=json.loads(receipt.read_text())
 for row in release['files']:assert sha(Path(row['path']))==row['after_sha256'],'live_source_changed'
 helper=BIN/'s9_hub_playback.py';assert sha(helper)==EXPECTED,'playback_initializer_changed'
 text=helper.read_text();anchor='    s9_rgb_video_playback_v1.install(handler_class,phone_rows,__import__("sys").modules[__name__])'
 assert text.count(anchor)==1 and 's9_visual_review_v36' not in text
 text=text.replace(anchor,anchor+'\n    # Keep review routes available if the archive entry point is regenerated.\n    import s9_visual_review_v36\n    s9_visual_review_v36.install(handler_class,external=hasattr(handler_class,"authorized"))')
 for script in ('test-visual-review-v36.py','test-folder-review-v40.py'):subprocess.run(['python3',str(stage/script)],check=True,timeout=45)
 changes={helper:text.encode(),BIN/'s9_visual_review_v36.py':(stage/'s9_visual_review_v36.py').read_bytes()}
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=Path(release['backup'])/('archive-route-'+stamp);backup.mkdir(mode=0o700);rows=[]
 for i,(p,raw) in enumerate(changes.items()):
  saved=backup/str(i);shutil.copy2(p,saved);rows.append({'path':str(p),'backup':str(saved),'after_sha256':hashlib.sha256(raw).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(rows,indent=2))
 try:
  for p,raw in changes.items():
   temp=p.with_name(p.name+'.v40-route');temp.write_bytes(raw);shutil.copymode(p,temp);temp.replace(p)
  services()
  for port in (8794,8795):
   for attempt in range(20):
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}/new/api/visual-review?workflow=clip_folders_v40',timeout=15) as r:assert json.load(r)['ok']
     break
    except OSError:
     if attempt==19:raise
     time.sleep(1)
  merged={r['path']:r for r in release['files']};merged.update({r['path']:r for r in rows});release.update(files=list(merged.values()),archive_initializer_backup=str(backup),archive_route_survives_entry_regeneration=True)
  receipt.write_text(json.dumps(release,indent=2));print(json.dumps({'ok':True,'ports':[8794,8795],'backup':str(backup)}))
 except BaseException:
  for row in rows:shutil.copy2(row['backup'],row['path'])
  services();raise
if __name__=='__main__':main(Path(sys.argv[1]))
