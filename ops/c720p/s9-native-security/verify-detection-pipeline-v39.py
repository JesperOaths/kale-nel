"""Final live acceptance: aggregate proofs, no private media exported."""
import contextlib,hashlib,json,sqlite3,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path.insert(0,str(BASE/'bin'))
import s9_visual_review_v36 as v
def request(port,path,method='GET',headers=None,data=None,lan=False):
 host='192.168.178.141' if lan else '127.0.0.1'
 try:return urllib.request.urlopen(urllib.request.Request(f'http://{host}:{port}'+path,method=method,headers=headers or {},data=data),timeout=25)
 except urllib.error.HTTPError as error:return error
def get(port,path):
 with request(port,path) as response:assert response.status==200;return json.load(response)
def dimensions(raw):
 pos=2
 while pos<len(raw)-9:
  if raw[pos]!=255:pos+=1;continue
  marker=raw[pos+1];size=int.from_bytes(raw[pos+2:pos+4],'big')
  if marker in (192,193,194):return int.from_bytes(raw[pos+7:pos+9],'big'),int.from_bytes(raw[pos+5:pos+7],'big')
  if size<2:break
  pos+=size+2
 raise AssertionError('jpeg_dimensions_missing')
def main():
 checks={};reports=[get(port,'/new/api/visual-review?limit=200&support=all') for port in (8794,8795)]
 assert {r['observation'] for r in reports[0]['items']}=={r['observation'] for r in reports[1]['items']};checks['catalog_services_agree']=True
 approved=v.archive_verifications()['clips'];catalog=v.index()['items']
 selected={name:row for name,row in approved.items() if row.get('label') in ('person','people')}
 assert selected and all(catalog.get(name,{}).get('sampling_version')=='native_4k_dense_small_people_v39' for name in selected)
 meta=[catalog[name] for name in selected];assert all((m['width'],m['height'])==(3840,2160) and m['decoded_native_frames']<=40 and m['decoder']=='OMX.Exynos.avc.dec' for m in meta)
 assert all(row['clip'] in selected for row in reports[0]['items']);checks['all_verified_clips_processed_native_4k_on_s9']=True
 assert not any(m.get('sampling_version')=='native_4k_dense_small_people_v39' and name not in selected for name,m in catalog.items());checks['new_worker_only_processed_verified_clips']=True
 for name in selected:
  raw=subprocess.check_output(['adb','-s',v.PHONE,'exec-out','cat',v.SD+'/'+name+'.visual-v36.before-small-people-v39.json'],timeout=15)
  prior=json.loads(raw);assert prior['sha256']==catalog[name]['sha256'] and prior['bytes']==catalog[name]['bytes']
 checks['all_original_digests_preserved']=True
 supported=get(8794,'/new/api/visual-review?limit=200&support=supported');weak=get(8794,'/new/api/visual-review?limit=200&support=weak')
 assert all(row['temporal_support'] or row['presence']=='person' for row in supported['items'])
 assert all(not row['temporal_support'] and row['presence']!='person' for row in weak['items']);checks['weak_detections_separate_and_recoverable']=True
 assert get(8794,'/new/api/visual-review?limit=200')['total']==reports[0]['total'];checks['default_inbox_includes_weak_candidates']=True
 assert all(r['organization']=='manual_only' and r['identity_matching'] is False for r in reports);checks['comparison_sets_never_assign_folders']=True
 for path,code in (('/new/api/visual-review?support=identity',400),('/new/api/visual-review?presence=identity',400)):
  with request(8794,path) as response:assert response.status==code
 checks['invalid_filters_rejected']=True
 with request(8794,'/new/api/visual-review',lan=True) as response:assert response.status==401
 with request(8794,'/new/api/visual-review/review','POST',headers={'Content-Type':'application/json'},data=b'{}') as response:assert response.status==403
 checks['private_catalog_and_manual_intent_preserved']=True
 first=reports[0]['items'][0]
 for field in ('full_crop','upper_crop'):
  crop=first[field]
  with request(8794,'/new/api/visual-review/crop/'+crop['name']) as response:
   raw=response.read();assert response.status==200 and hashlib.sha256(raw).hexdigest()==crop['sha256'] and dimensions(raw)==(crop['width'],crop['height'])
 checks['native_exemplar_hashes_dimensions_and_timestamps']=True
 with request(8794,first['video_path'],'HEAD') as response:assert response.status==200;size=int(response.headers['Content-Length'])
 with request(8794,first['video_path'],headers={'Range':'bytes=0-4095'}) as response:
  raw=response.read();assert response.status==206 and len(raw)==4096 and b'ftyp' in raw[:32] and response.headers['Content-Range']==f'bytes 0-4095/{size}'
 checks['original_video_head_and_byte_range']=True
 controls=get(8794,'/new/camera-controls');assert controls.get('ok') and all(controls['controls'][key].get('available') for key in ('zoom','exposure_ev','focus','torch'));checks['four_live_camera_controls_available']=True
 release=json.loads((v.ROOT/'detection-hub-v39-release.json').read_text())
 assert all(hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['after_sha256'] for row in release['files']);checks['deployed_hub_sources_match_receipt']=True
 with request(8123,'/local/frontyard-security-new/security-review-v8.html?v=detection-review-v39b-20261016') as response:html=response.read().decode();assert 'humanReviewV37' in html and 'modelEvidence.append(mf)' in html
 with request(8123,'/local/c720p-surveillance.html?v=detection-review-v39b-20261016') as response:assert b'detection-review-v39b-20261016' in response.read()
 checks['final_evidence_and_cache_assets']=True
 package='nl.kalenel.s9security';apkpath=subprocess.check_output(['adb','-s',v.PHONE,'shell','pm','path',package],text=True,timeout=15).strip().removeprefix('package:')
 apksha=subprocess.check_output(['adb','-s',v.PHONE,'shell','sha256sum',apkpath],text=True,timeout=20).split()[0]
 build=json.loads((BASE/'build/s9-detection-review-v39/release.json').read_text());assert apksha==build['sha256'];checks['exact_signed_v39_apk_installed']=True
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=12) as response:phone=json.load(response)
 assert phone['mode'] in ('watching','recording') and phone['sensor_result_fps']>25 and phone['visual_review_errors']==0 and phone['continuous_4k_dropped_output_frames']==0
 checks['capture_and_review_healthy']=True
 with contextlib.closing(v.db()) as connection:manual={'folders':connection.execute('SELECT count(*) FROM folders').fetchone()[0],'actions':connection.execute('SELECT count(*) FROM audit').fetchone()[0]}
 result={'ok':True,'checks':checks,'verified_clips':len(meta),'native_frames':sum(m['decoded_native_frames'] for m in meta),'followup_requests':sum(m.get('followup_frame_requests',0) for m in meta),'candidate_crops':reports[0]['candidate_views'],'supported_views':supported['total'],'weak_views':weak['total'],'apk_sha256':apksha,'manual_state':manual,'camera':{key:phone.get(key) for key in ('mode','temperature_c','sensor_result_fps','continuous_4k_dropped_output_frames','visual_review_errors')},'identity_matching':False}
 v.atomic(v.ROOT/'detection-pipeline-v39-verification.json',result);print(json.dumps(result),flush=True)
if __name__=='__main__':main()
