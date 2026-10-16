"""Guarded static-only People folder layout upgrade. No recorder, catalog or review mutations."""
from pathlib import Path
import contextlib,datetime,hashlib,json,shutil,sqlite3,sys,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');UI=Path('/opt/homeassistant/config/www/frontyard-security-new');ROOT=BASE/'state/s9-visual-attributes-v36'
VERSION='folder-first-v42-20261017';PREVIOUS='manual-folders-v40a-20261016'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get(port,path):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=25) as r:return json.load(r)
def rows():
 with sqlite3.connect('file:'+str(ROOT/'review.sqlite3')+'?mode=ro',uri=True) as c:
  return {name:sorted(hashlib.sha256(json.dumps(list(row),separators=(',',':')).encode()).hexdigest() for row in c.execute('SELECT * FROM '+name)) for name in ('folders','reviews','audit','revision','folder_clips_v40','inbox_skips_v40')}
def main(stage):
 manifest=json.loads((stage/'manifest.json').read_text())
 for name,digest in manifest.items():
  if sha(stage/name)!=digest:raise RuntimeError('staged_file_changed:'+name)
 old=json.loads((ROOT/'folder-review-v40-release.json').read_text());expected={r['path']:r['after_sha256'] for r in old['files']}
 html=(stage/'people-folders-v42.html').read_bytes();js=(stage/'people-folders-v42.js').read_bytes()
 changes={UI/'people-folders-v42.html':html,UI/'people-folders-v42.js':js}
 for name in ('face-appearances.html','security-people-v33.html','people-folders-v40.html'):changes[UI/name]=html
 for p in (UI/'security-hub-v30.html',UI.parent/'c720p-surveillance.html',UI/'security-hub-v30.js'):
  raw=p.read_bytes()
  if PREVIOUS.encode() not in raw:raise RuntimeError('unexpected_security_entry_version:'+str(p))
  changes[p]=raw.replace(PREVIOUS.encode(),VERSION.encode())
 p=UI/'visual-review-entry-v36.js';raw=p.read_bytes();needle=b'people-folders-v40.html?v=40a'
 if raw.count(needle)!=1:raise RuntimeError('archive_review_entry_changed')
 changes[p]=raw.replace(needle,b'people-folders-v42.html?v=42')
 for name in ('security-review-v8.html','security-archive-v7.html','clips.html'):
  p=UI/name;raw=p.read_bytes();needle=b'visual-review-entry-v36.js?v=40a'
  if raw.count(needle)!=1:raise RuntimeError('archive_script_version_changed:'+name)
  changes[p]=raw.replace(needle,b'visual-review-entry-v36.js?v=42')
 for p in changes:
  if p.exists():
   if str(p) not in expected or sha(p)!=expected[str(p)]:raise RuntimeError('live_asset_changed:'+str(p))
  elif p.name not in ('people-folders-v42.html','people-folders-v42.js'):raise RuntimeError('missing_live_asset:'+str(p))
 # Preserve the night upgrade and all backend code as found, not the old V40 adapter hash.
 protected={str(p):sha(p) for p in (BASE/'bin/s9_phone_garden_status.py',BASE/'bin/s9_visual_review_v36.py',BASE/'bin/s9_folder_review_v40.py',BASE/'bin/s9_hub_playback.py',UI/'security-tracks-v7.html')}
 phone_before=get(18808,'/status');detector_before=phone_before.get('motion_detector')
 if not phone_before.get('ok') or not detector_before:raise RuntimeError('capture_not_available_before_static_change')
 before=rows();catalog_sha=sha(ROOT/'catalog.json');stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 back=BASE/'backups/s9-folder-first-v42'/stamp;back.mkdir(mode=0o700,parents=True)
 with sqlite3.connect(ROOT/'review.sqlite3') as source,sqlite3.connect(back/'review.sqlite3') as dest:source.backup(dest)
 (back/'review.sqlite3').chmod(0o600);saved=[]
 for i,(p,raw) in enumerate(changes.items()):
  copy=back/str(i)
  if p.exists():shutil.copy2(p,copy)
  saved.append({'path':str(p),'backup':str(copy) if copy.exists() else None,'before_sha256':sha(copy) if copy.exists() else None,'after_sha256':hashlib.sha256(raw).hexdigest()})
 (back/'restore.json').write_text(json.dumps(saved,indent=2))
 try:
  for p,raw in changes.items():
   tmp=p.with_name(p.name+'.v42-stage');tmp.write_bytes(raw)
   if p.exists():shutil.copymode(p,tmp)
   else:tmp.chmod(0o644)
   tmp.replace(p)
  checks={}
  if rows()!=before:raise RuntimeError('manual_state_changed_during_install')
  checks['existing_manual_decisions_preserved']=True
  if sha(ROOT/'catalog.json')!=catalog_sha:raise RuntimeError('catalog_changed_during_install')
  checks['existing_detection_catalog_preserved']=True
  if not all(sha(Path(p))==digest for p,digest in protected.items()):raise RuntimeError('protected_component_changed')
  checks['night_detector_adapter_backend_and_tracks_preserved']=True
  if not all(sha(Path(r['path']))==r['after_sha256'] for r in saved):raise RuntimeError('asset_install_mismatch')
  checks['all_new_assets_match_stage']=True
  for port in (8794,8795):
   data=get(port,'/new/api/visual-review?workflow=clip_folders_v40&tab=inbox&limit=100')
   if not data['ok'] or data['identity_matching'] or data['auto_assignments']:raise RuntimeError('review_api_regression')
   if len({r['clip'] for r in data['items']})!=len(data['items']):raise RuntimeError('duplicated_recording_cards')
   status=get(port,'/new/api/live-person-watch')
   if not status['ok'] or status['detector_version']!=detector_before:raise RuntimeError('live_detector_status_changed')
  checks['both_review_and_existing_detector_status_routes_available']=True
  for name in ('people-folders-v42.html','people-folders-v42.js','face-appearances.html','security-people-v33.html','people-folders-v40.html'):
   with urllib.request.urlopen('http://127.0.0.1:8123/local/frontyard-security-new/'+name+'?v=42',timeout=25) as r:
    if hashlib.sha256(r.read()).hexdigest()!=hashlib.sha256(changes[UI/name]).hexdigest():raise RuntimeError('served_asset_mismatch:'+name)
  checks['home_assistant_serves_new_page_and_all_aliases']=True
  phone=get(18808,'/status')
  if phone['motion_detector']!=detector_before or phone['sensor_result_fps']<28 or phone['continuous_4k_dropped_output_frames'] or phone['garden_person_gate_errors']:raise RuntimeError('capture_health_changed')
  checks['s9_capture_healthy']=True
  receipt={'ok':True,'version':VERSION,'deployed_at':stamp,'backup':str(back),'files':saved,'protected':protected,'catalog_sha256':catalog_sha,'manual_rows':before,'checks':checks,'folders':len(data['folders']),'verified_clips':data['coverage']['verified_clips'],'processed_clips':data['coverage']['processed_clips'],'identity_matching':False,'auto_assignments':False,'camera':{k:phone.get(k) for k in ('motion_detector','sensor_result_fps','temperature_c','continuous_4k_dropped_output_frames')}}
  (ROOT/'folder-first-v42-release.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({k:v for k,v in receipt.items() if k not in ('files','protected','manual_rows')}),flush=True)
 except BaseException:
  for r in saved:
   p=Path(r['path'])
   if r['backup']:shutil.copy2(r['backup'],p)
   elif p.exists() and sha(p)==r['after_sha256']:p.unlink()
  # Never restore the review database over subsequent human choices.
  raise
if __name__=='__main__':main(Path(sys.argv[1]))
