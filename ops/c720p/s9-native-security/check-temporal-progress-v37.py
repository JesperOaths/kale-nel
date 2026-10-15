"""Aggregate progress only; actual images and frame descriptors remain private."""
import json,sys,urllib.request
from pathlib import Path
sys.path.insert(0,'/home/jespern/c720p-home-hub/bin')
import s9_visual_review_v36 as v
def main():
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=12) as r:phone=json.load(r)
 verified={k:r for k,r in v.archive_verifications()['clips'].items() if r.get('label') in ('person','people')}
 catalog=v.index()['items'];done=[m for name,m in catalog.items() if name in verified and m.get('sampling_version')=='native_4k_temporal_followup_v37']
 report=v.report({'support':['all'],'limit':['200']})
 result={'verified_clips':len(verified),'processed_v37':len(done),'native_frames':sum(m['decoded_native_frames'] for m in done),
  'followup_requests':sum(m.get('followup_frame_requests',0) for m in done),'catalog_candidates':report['candidate_views'],
  'weak_views':report['weak_views_held'],'camera':{k:phone.get(k) for k in ('mode','temperature_c','sensor_result_fps','continuous_4k_dropped_output_frames','visual_review_busy','visual_review_completed','visual_review_errors','visual_review_last_error','visual_review_sampling_version')},
  'decoders':sorted({m['decoder'] for m in done}),'all_native_4k':all((m['width'],m['height'])==(3840,2160) for m in done),
  'all_only_verified':not any(m.get('sampling_version')=='native_4k_temporal_followup_v37' and name not in verified for name,m in catalog.items()),
  'max_frames_per_clip':max((m['decoded_native_frames'] for m in done),default=0)}
 print(json.dumps(result),flush=True)
 return result
if __name__=='__main__':main()
