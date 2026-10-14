"""Live aggregate proofs. Actual crops and footage stay on phone/hub."""
import contextlib,hashlib,io,json,sqlite3,subprocess,sys,urllib.error,urllib.request
from pathlib import Path
sys.path.insert(0,'/home/jespern/c720p-home-hub/bin')
import s9_visual_review_v36 as v
def request(url,method='GET',data=None,headers=None):
 try:return urllib.request.urlopen(urllib.request.Request(url,method=method,data=data,headers=headers or {}),timeout=25)
 except urllib.error.HTTPError as error:return error
def main():
 result={'checks':{}}
 for port in (8794,8795):
  with request(f'http://127.0.0.1:{port}/new/api/visual-review?limit=2') as response:
   d=json.load(response);assert response.status==200 and d['ok'];result['checks'][f'catalog_{port}']=True
 with request('http://192.168.178.141:8794/new/api/visual-review') as response:assert response.status==401;result['checks']['anonymous_catalog_denied']=True
 with request('http://127.0.0.1:8794/new/api/visual-review/review','POST',b'{}',{'Content-Type':'application/json'}) as response:assert response.status==403;result['checks']['missing_review_intent_denied']=True
 with request('http://127.0.0.1:8794/new/api/visual-review?embedding=x') as response:assert response.status==400;result['checks']['unknown_filter_denied']=True
 with request('http://127.0.0.1:8794/new/api/visual-review/review','OPTIONS',headers={'Origin':'http://192.168.178.141:8123','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-s9-visual-review-intent'}) as response:
  assert response.status==204 and 'X-S9-Visual-Review-Intent' in response.headers['Access-Control-Allow-Headers'];result['checks']['browser_review_preflight']=True
 items=list(v.observations().values());assert items,'no_real_4k_views_yet'
 first=items[0];dimensions=[]
 for field in ('full_crop','upper_crop'):
  crop=first[field];path='/new/api/visual-review/crop/'+crop['name']
  with request('http://127.0.0.1:8794'+path) as response:
   raw=response.read();assert response.status==200 and len(raw)==crop['bytes'] and hashlib.sha256(raw).hexdigest()==crop['sha256']
  # Parse JPEG SOF locally. No private image is exported to the operator.
  pos=2;found=None
  while pos<len(raw)-9:
   if raw[pos]!=255:pos+=1;continue
   marker=raw[pos+1];size=int.from_bytes(raw[pos+2:pos+4],'big')
   if marker in (192,193,194):found=(int.from_bytes(raw[pos+7:pos+9],'big'),int.from_bytes(raw[pos+5:pos+7],'big'));break
   if size<2:break
   pos+=size+2
  assert found==(crop['width'],crop['height']);dimensions.append(found)
  with request('http://192.168.178.141:8794'+path) as response:assert response.status==401
 result['checks']['private_crop_hashes_native_dimensions_and_auth']=True
 original='http://127.0.0.1:8794'+first['video_path']
 with request(original,'HEAD') as response:
  assert response.status==200;size=int(response.headers['Content-Length'])
 with request(original,headers={'Range':'bytes=0-4095'}) as response:
  raw=response.read();assert response.status==206 and len(raw)==4096 and b'ftyp' in raw[:32] and response.headers['Content-Range']==f'bytes 0-4095/{size}'
 result['checks']['original_video_head_and_byte_range']=True
 saved=json.load(request('http://127.0.0.1:8794/new/api/saved'))
 saved_rows=[r for value in saved.values() if isinstance(value,list) for r in value if isinstance(r,dict)]
 row=next(r for r in saved_rows if r.get('remote_name')==first['clip'])
 assert row.get('person_count')==first['repeated_simultaneous'] and row.get('person_count_is_unique_identities') is False
 result['checks']['saved_catalog_uses_concurrent_not_tracklet_counts']=True
 release=json.loads((v.ROOT/'hub-release.json').read_text())
 assert all(hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['after_sha256'] for item in release['files'])
 result['checks']['all_deployed_hub_source_hashes']=True
 source=json.loads((v.BASE/'build/s9-visual-attributes-v36/release.json').read_text())
 path=subprocess.check_output(['adb','-s',v.PHONE,'shell','pm','path','nl.kalenel.s9security'],text=True,timeout=15).strip().removeprefix('package:')
 actual=subprocess.check_output(['adb','-s',v.PHONE,'shell','sha256sum',path],text=True,timeout=20).split()[0]
 assert actual==source['sha256'];result['checks']['exact_installed_signed_apk']=True
 result['apk_sha256']=actual
 with request('http://127.0.0.1:8123/local/c720p-surveillance.html?v=visual-review-v36b-20261014') as response:assert b'visual-review-v36b-20261014' in response.read()
 result['checks']['final_security_cache_entry_asset']=True
 result['crop_dimensions']=dimensions
 with contextlib.closing(v.db()) as connection:
  result['manual_review_folders']=connection.execute('SELECT count(*) FROM folders').fetchone()[0]
  result['manual_review_actions']=connection.execute('SELECT count(*) FROM audit').fetchone()[0]
 state=json.load(request('http://127.0.0.1:18808/status'))
 result['camera']={k:state.get(k) for k in ('mode','temperature_c','sensor_result_fps','continuous_4k_ready','continuous_4k_dropped_output_frames','motion_detector','person_post_motion_hold_ms','visual_review_completed','visual_review_errors','visual_review_last_error')}
 meta=list(v.index()['items'].values());result['processed_clips']=len(meta);result['tracks']=len(items);result['crops']=len(items)*2;result['native_frames']=sum(m['decoded_native_frames'] for m in meta);result['decoders']=sorted({m['decoder'] for m in meta});result['identity_matching']=False
 result['clips_with_unconfirmed_extra_boxes']=sum(m['peak_simultaneous']>m['repeated_simultaneous'] for m in meta)
 result['clips_with_more_tracklets_than_concurrent_detections']=sum(m['tracklet_count']>m['peak_simultaneous'] for m in meta)
 v.atomic(v.ROOT/'pipeline-verification.json',result);print(json.dumps(result),flush=True)
if __name__=='__main__':main()
