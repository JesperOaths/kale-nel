"""Guarded adapter install and live metadata/original-integrity acceptance. No media export."""
import contextlib,hashlib,json,sqlite3,subprocess,sys,time,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
import s9_visual_review_v36 as v
ROOT=BASE/'backups/s9-night-detection-v41';ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
BEFORE=ROOT/'hub-before.json';ADAPTER=BASE/'bin/s9_phone_garden_status.py'
OLD='11453c7897a25c08b31edccdfb3dfcbaae63a3a76567254fa57f6c48f5f93cec'
INITIAL='48a40dc4793b9b88e6eb7ec1e4551dbe18ca1111e537826b8e648e7c646002a0'
NEW='1e1e5d286a86c55a305b5e5982c12f91c0522fd25bb2f79a9aa4776ad54cad59'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get(port,path):
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=20) as r:return json.load(r)
def manual():
 with contextlib.closing(v.db()) as c:
  result={}
  for name in ('folders','reviews','audit','folder_clips_v40','inbox_skips_v40'):
   result[name]=sorted(hashlib.sha256(json.dumps(list(r),ensure_ascii=True,separators=(',',':')).encode()).hexdigest() for r in c.execute('SELECT * FROM '+name))
  return result
def originals(names):
 assert names and all(v.CLIP.fullmatch(n) for n in names)
 args=['adb','-s',v.PHONE,'shell','sha256sum',*[v.SD+'/'+n for n in names]]
 output=subprocess.check_output(args,text=True,timeout=120)
 rows={line.split()[1].split('/')[-1]:line.split()[0] for line in output.splitlines()}
 assert set(rows)==set(names);return rows
def before():
 assert not BEFORE.exists(),'existing_baseline_do_not_overwrite'
 assert sha(ADAPTER)==OLD
 (ROOT/'s9_phone_garden_status.before.py').write_bytes(ADAPTER.read_bytes())
 with contextlib.closing(v.db()) as c,sqlite3.connect(ROOT/'review.before.sqlite3') as backup:c.backup(backup)
 phone=get(18808,'/status');names=[n for n,r in v.archive_verifications()['clips'].items() if r['label'] in ('person','people')]
 if v.CLIP.fullmatch(phone.get('last_file','')):names=sorted(set(names+[phone['last_file']]))
 release=json.loads((v.ROOT/'folder-review-v40-release.json').read_text())
 assets={row['path']:sha(Path(row['path'])) for row in release['files']}
 saved={'manual':manual(),'originals':originals(names),'assets':assets,'adapter_sha256':OLD,'phone':phone}
 v.atomic(BEFORE,saved)
 print(json.dumps({'backup':str(ROOT),'original_videos_hashed':len(names),'manual_counts':{k:len(r) for k,r in saved['manual'].items()},'brightness':phone.get('brightness')}),flush=True)
def adapter():
 assert BEFORE.exists() and sha(ADAPTER) in (OLD,INITIAL)
 if sha(ADAPTER)==INITIAL:(ROOT/'s9_phone_garden_status.initial-v41.py').write_bytes(ADAPTER.read_bytes())
 source=Path('/tmp/s9_phone_garden_status-v41.py');assert sha(source)==NEW
 compile(source.read_bytes(),str(source),'exec')
 temp=ADAPTER.with_suffix('.night-v41.tmp');temp.write_bytes(source.read_bytes());temp.chmod(0o600);temp.replace(ADAPTER)
 subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service','c720p-lan-camera-relay.service'],check=True,timeout=45)
 print('NIGHT_STATUS_ADAPTER_INSTALLED',flush=True)
def verify():
 old=json.loads(BEFORE.read_text());checks={}
 assert originals(list(old['originals']))==old['originals'];checks['original_videos_unchanged']=True
 current=manual();assert current==old['manual'];checks['manual_folders_approvals_rejections_unchanged']=True
 assert old['assets'][str(ADAPTER)]==OLD
 assert all(sha(Path(p))==digest for p,digest in old['assets'].items() if Path(p)!=ADAPTER);checks['security_ui_and_folder_backend_unchanged']=True
 assert sha(ADAPTER)==NEW;checks['exact_status_adapter']=True
 release=json.loads(Path('/tmp/s9-night-detection-v41/release.json').read_text())
 path=subprocess.check_output(['adb','-s',v.PHONE,'shell','pm','path','nl.kalenel.s9security'],text=True,timeout=20).strip().removeprefix('package:')
 installed=subprocess.check_output(['adb','-s',v.PHONE,'shell','sha256sum',path],text=True,timeout=25).split()[0]
 assert installed==release['sha256'];checks['exact_signed_night_apk_installed']=True
 observations=[]
 for n in range(18):
  phone=get(18808,'/status')
  assert phone['motion_detector']=='night_temporal_transport_v41' and phone['garden_person_gate_backend']=='gpu'
  assert phone['mode'] in ('watching','recording') and phone['sensor_result_fps']>28
  assert phone['temperature_c']<37 and phone['continuous_4k_dropped_output_frames']==0
  assert phone['garden_person_gate_errors']==0 and phone['visual_review_errors']==0 and not phone['continuous_4k_error']
  assert phone['visual_review_sampling_version']=='native_4k_dense_small_people_v39' and phone['person_post_motion_hold_ms']==10000
  if phone['brightness']<55:
   assert phone['garden_person_night_active'] and phone['garden_person_gate_required_positive_frames']==3
   assert phone['garden_person_local_motion_max_age_ms']==1200
  observations.append({k:phone.get(k) for k in ('mode','brightness','sensor_result_fps','temperature_c','garden_person_gate_checked','garden_person_night_active','garden_person_night_rejected','garden_person_night_confirmed','garden_person_gate_confirmed_starts','continuous_4k_dropped_output_frames')})
  if n%3==0:print(json.dumps({'live_night_sample':n,**observations[-1]}),flush=True)
  if n<17:time.sleep(10)
 assert observations[-1]['garden_person_gate_checked']>observations[0]['garden_person_gate_checked'];checks['live_inference_keeps_progressing']=True
 checks['three_minute_night_capture_health']=True
 for port in (8794,8795):
  report=get(port,'/new/api/live-person-watch');assert report['ok'] and report['detector_version']=='night_temporal_transport_v41'
  assert report['night_detection_active']==phone['garden_person_night_active']
  folders=get(port,'/new/api/visual-review?workflow=clip_folders_v40&tab=all&limit=100');assert folders['identity_matching'] is False
  controls=get(port,'/new/camera-controls');assert controls['ok']
 checks['both_hub_routes_camera_controls_and_review_available']=True
 result={'ok':True,'checks':checks,'apk_sha256':installed,'original_video_count':len(old['originals']),'manual_counts':{k:len(r) for k,r in current.items()},'night_observations':observations,'real_world_precision_recall_measured':False}
 out=BASE/'state/s9-visual-attributes-v36/night-v41-verification.json';v.atomic(out,result);print(json.dumps({k:r for k,r in result.items() if k!='night_observations'}),flush=True)
if __name__=='__main__':{'before':before,'adapter':adapter,'verify':verify}[sys.argv[1]]()
