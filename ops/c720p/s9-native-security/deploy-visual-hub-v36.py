"""Install private attribute catalog/manual UI with complete source rollback."""
from pathlib import Path
import datetime,hashlib,json,py_compile,shutil,subprocess,sys,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');BIN=BASE/'bin';WWW=Path('/opt/homeassistant/config/www');UI=WWW/'frontyard-security-new'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True,timeout=45).stdout
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():
  if sha(stage/name)!=digest:raise RuntimeError('staged_source_changed')
 py_compile.compile(str(stage/'s9_visual_review_v36.py'),doraise=True)
 tested=run(['/usr/bin/python3',str(stage/'test-visual-review-v36.py')]);print('HUB_MANUAL_REVIEW_TESTS_PASSED',flush=True)
 relay=BIN/'c720p-lan-camera-relay.py';proxy=BIN/'s9_sd_proxy_extension.py'
 # Guard the exact live files inspected before staging.
 guard=json.loads((stage/'live-guards.json').read_text())
 if any(sha(BIN/name)!=digest for name,digest in guard.items()):raise RuntimeError('live_source_changed_refuse_overwrite')
 relay_text=relay.read_text();proxy_text=proxy.read_text()
 marker="if __name__=='__main__':"
 if relay_text.count(marker)!=1 or 's9_visual_review_v36' in relay_text or 's9_visual_review_v36' in proxy_text:raise RuntimeError('unexpected_existing_install')
 relay_text=relay_text.replace(marker,"import s9_visual_review_v36\ns9_visual_review_v36.install(H,external=True)\n"+marker)
 relay_text=relay_text.replace('X-S9-Verified-People-Intent\'','X-S9-Verified-People-Intent,X-S9-Visual-Review-Intent\'',1)
 marker=' s9_verified_people_v33.install(H)'
 if proxy_text.count(marker)!=1:raise RuntimeError('archive_install_contract_changed')
 proxy_text=proxy_text.replace(marker,marker+'\n import s9_visual_review_v36\n s9_visual_review_v36.install(H)')
 changes={relay:relay_text.encode(),proxy:proxy_text.encode(),BIN/'s9_visual_review_v36.py':(stage/'s9_visual_review_v36.py').read_bytes()}
 for name in ('visual-review-v36.html','visual-review-v36.js','visual-review-entry-v36.js'):changes[UI/name]=(stage/name).read_bytes()
 # Replace only review destinations. Earlier source/state and labels are backed up.
 for name in ('security-people-v33.html','face-appearances.html','security-tracks-v7.html'):changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 old='ensemble-people-v35-20261014';new='visual-review-v36b-20261014'
 for path in (WWW/'c720p-surveillance.html',UI/'security-hub-v30.html',UI/'security-hub-v30.js'):
  if not path.exists() and path.name=='security-hub-v30.html':continue
  body=path.read_text()
  if old not in body:raise RuntimeError('security_entry_changed')
  changes[path]=body.replace(old,new).encode()
 # Keep archive/today playback, verification, selection and deletion controls.
 for name in ('security-archive-v7.html','security-review-v8.html','clips.html'):
  path=UI/name
  if not path.exists():continue
  body=path.read_text()
  if 'visual-review-entry-v36.js' in body:raise RuntimeError('review_entry_already_installed')
  changes[path]=body.replace('</body>','<script defer src="/local/frontyard-security-new/visual-review-entry-v36.js?v=36b"></script></body>').encode()
 backup=BASE/'backups/s9-visual-attributes-v36'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup.mkdir(parents=True,mode=0o700)
 saved=[]
 for number,path in enumerate(changes):
  original=backup/str(number)
  if path.exists():shutil.copy2(path,original)
  saved.append({'path':str(path),'backup':str(original) if original.exists() else None,'after_sha256':hashlib.sha256(changes[path]).hexdigest()})
 (backup/'restore.json').write_text(json.dumps(saved,indent=2)+'\n')
 try:
  for path,raw in changes.items():
   temp=path.with_name(path.name+'.v36-stage');temp.write_bytes(raw);shutil.copymode(path,temp) if path.exists() else temp.chmod(0o600 if path.parent==BIN else 0o644);temp.replace(path)
  for path in (relay,proxy,BIN/'s9_visual_review_v36.py'):py_compile.compile(str(path),doraise=True)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'])
  for _ in range(20):
   try:
    with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?limit=1',timeout=3) as response:data=json.load(response)
    if data.get('ok'):break
   except Exception:time.sleep(.5)
  else:raise RuntimeError('new_catalog_endpoint_not_healthy')
  unit=Path.home()/'.config/systemd/user';service=unit/'c720p-s9-visual-index-v36.service';timer=unit/'c720p-s9-visual-index-v36.timer'
  if service.exists() or timer.exists():raise RuntimeError('index_unit_already_exists')
  service.write_text('[Unit]\nDescription=S9+ visual metadata index (no hub inference)\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 '+str(BIN/'s9_visual_review_v36.py')+'\nNice=15\nTimeoutStartSec=180\n')
  timer.write_text('[Unit]\nDescription=Refresh phone visual metadata\n[Timer]\nOnBootSec=90\nOnUnitInactiveSec=30\nPersistent=false\n[Install]\nWantedBy=timers.target\n')
  run(['systemctl','--user','daemon-reload']);run(['systemctl','--user','enable','--now',timer.name])
  run(['systemctl','--user','start',service.name])
  receipt={'ok':True,'backup':str(backup),'files':saved,'identity_matching':False,'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  (BASE/'state/s9-visual-attributes-v36/hub-release.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'ok':True,'backup':str(backup),'files':len(saved)}),flush=True)
 except BaseException:
  for item in reversed(saved):
   path=Path(item['path'])
   if item['backup']:shutil.copy2(item['backup'],path)
   elif path.exists():path.unlink()
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service']);raise
if __name__=='__main__':main(Path(sys.argv[1]))
