"""Guarded metadata/UI deployment, preserving recording and review state."""
import contextlib,datetime,hashlib,json,py_compile,shutil,sqlite3,subprocess,sys,time,urllib.request,re
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');BIN=BASE/'bin';WWW=Path('/opt/homeassistant/config/www');UI=WWW/'frontyard-security-new'
OLD='verified-crops-v36c-20261015';NEW='temporal-review-v37-20261015'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=70).stdout
def once(body,old,new):
 if body.count(old)!=1:raise RuntimeError('source_contract_changed:'+old[:70])
 return body.replace(old,new,1)
def patch_shell(body):
 body,n=re.subn(r"version='v=[A-Za-z0-9-]+'", "version='v="+NEW+"'",body,count=1)
 if n!=1 or 'security-tab-ready-v37' in body:raise RuntimeError('shell_version_changed')
 body=once(body,"const api=()=>window.C720PSecureRelay;", "const api=()=>window.C720PSecureRelay;\nconst embeddedTabs=new WeakSet();")
 body=once(body,"if(f)f.src=f.dataset.src", "if(f){if(embeddedTabs.has(f))f.contentWindow.postMessage({kind:'security-tab-refresh-v37'},location.origin);else f.src=f.dataset.src}")
 body=once(body," live(id==='live'", " for(const [key] of tabs){const f=paneFor(key).querySelector('iframe');if(f?.contentWindow)f.contentWindow.postMessage({kind:'security-tab-visibility-v37',active:key===id},location.origin)}\n live(id==='live'")
 return once(body,"show('live');refreshHealth();", "window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.kind!=='security-tab-ready-v37')return;for(const [key] of tabs){const f=paneFor(key).querySelector('iframe');if(f?.contentWindow===event.source){embeddedTabs.add(f);event.source.postMessage({kind:'security-tab-visibility-v37',active:key===current},location.origin)}}});\nshow('live');refreshHealth();")
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():
  if sha(stage/name)!=digest:raise RuntimeError('staged_source_changed')
 release=json.loads((BASE/'state/s9-visual-attributes-v36/verified-crops-v36c-release.json').read_text())
 for item in release['files']:
  if sha(Path(item['path']))!=item['after_sha256']:raise RuntimeError('newer_live_release:'+item['path'])
 run(['python3',str(stage/'test-visual-review-v36.py')]);py_compile.compile(str(stage/'s9_visual_review_v36.py'),doraise=True)
 changes={BIN/'s9_visual_review_v36.py':(stage/'s9_visual_review_v36.py').read_bytes()}
 for name in ('visual-review-v36.html','visual-review-v36.js','visual-review-entry-v36.js','security-embedded-shell-v37.js'):changes[UI/name]=(stage/name).read_bytes()
 for name in ('security-people-v33.html','face-appearances.html','security-tracks-v7.html'):changes[UI/name]=(stage/'visual-review-v36.html').read_bytes()
 changes[UI/'security-hub-v30.js']=patch_shell((UI/'security-hub-v30.js').read_text()).encode()
 for path in (WWW/'c720p-surveillance.html',UI/'security-hub-v30.html'):
  if path.exists():changes[path]=once(path.read_text(),OLD,NEW).encode()
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  path=UI/name
  if not path.exists():continue
  body=path.read_text()
  if 'security-embedded-shell-v37.js' in body:raise RuntimeError('already_patched:'+name)
  body=once(body,'</body>','<script defer src="/local/frontyard-security-new/security-embedded-shell-v37.js?v=37"></script></body>')
  body=body.replace('visual-review-entry-v36.js?v=36b','visual-review-entry-v36.js?v=37')
  changes[path]=body.encode()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=BASE/'backups/s9-temporal-review-v37'/stamp;backup.mkdir(mode=0o700,parents=True)
 saved=[]
 for n,path in enumerate(changes):
  copy=backup/str(n)
  if path.exists():shutil.copy2(path,copy)
  saved.append({'path':str(path),'backup':str(copy) if copy.exists() else None,'after_sha256':hashlib.sha256(changes[path]).hexdigest()})
 with contextlib.closing(sqlite3.connect(BASE/'state/s9-visual-attributes-v36/review.sqlite3')) as source:
  with contextlib.closing(sqlite3.connect(backup/'review.sqlite3')) as dest:source.backup(dest)
 (backup/'review.sqlite3').chmod(0o600);(backup/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for path,raw in changes.items():
   temp=path.with_name(path.name+'.v37-stage');temp.write_bytes(raw)
   shutil.copymode(path,temp) if path.exists() else temp.chmod(0o644)
   temp.replace(path)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'])
  queue=run(['python3',str(BIN/'s9_visual_review_v36.py')])
  with urllib.request.urlopen('http://127.0.0.1:8794/new/api/visual-review?limit=1',timeout=15) as response:report=json.load(response)
  assert report['ok'] and 'weak_views_held' in report
  receipt={'ok':True,'backup':str(backup),'files':saved,'queue_sync':json.loads(queue),'visible_supported_views':report['total'],'weak_views_held':report['weak_views_held'],'deployed_at':stamp}
  (BASE/'state/s9-visual-attributes-v36/temporal-hub-v37-release.json').write_text(json.dumps(receipt,indent=2))
  print(json.dumps({k:v for k,v in receipt.items() if k!='files'}),flush=True)
 except BaseException:
  for item in reversed(saved):
   if item['backup']:shutil.copy2(item['backup'],item['path'])
   else:Path(item['path']).unlink(missing_ok=True)
  run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service']);raise
if __name__=='__main__':main(Path(sys.argv[1]))
