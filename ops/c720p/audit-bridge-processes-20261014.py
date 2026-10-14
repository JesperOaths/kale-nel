#!/usr/bin/env python3
"""Bounded read-only live person-detector v9 and real-archive evidence report."""
from collections import Counter
import json,urllib.request
def fetch(url):
 try:
  with urllib.request.urlopen(url,timeout=11) as r:
   if r.status!=200:return {'error':'HTTP '+str(r.status)}
   return json.load(r)
 except Exception as e:return {'error':type(e).__name__}
cam=fetch('http://127.0.0.1:18808/status')
keys=['ok','mode','motion_detector','temperature_c','garden_person_gate_backend',
'garden_person_gate_ready','garden_person_gate_confirmed',
'garden_person_transport_conflicts_total','garden_person_requires_local_motion_or_spatial_translation',
'continuous_4k_production_persisted','continuous_4k_trial_active','continuous_4k_ready',
'continuous_4k_buffered_ms','continuous_4k_last_result','preroll_enabled',
'preroll_ready','preroll_buffered_ms','preroll_version','last_frame_age_ms','sd_free_bytes',
'recordings_this_hour','person_post_motion_hold_ms']
print('S9_CURRENT_CAMERA_STATUS',json.dumps({k:cam.get(k) for k in keys},sort_keys=True))
idx=fetch('http://127.0.0.1:8794/new/api/saved')
rows=idx.get('events',[]) if isinstance(idx.get('events'),list) else []
cats=Counter(str(x.get('scene_category') or x.get('person_status') or 'unreviewed') for x in rows)
labels=Counter(str(x.get('person_review_status') or x.get('human_reviewed') or 'not_reviewed') for x in rows)
print('S9_CURRENT_CLIP_EVIDENCE',json.dumps({'events':len(rows),'scene_categories':dict(cats),
 'review_flags':dict(labels),'index_error':idx.get('error')},sort_keys=True))
for source in ('sd','drive'):
 review=fetch('http://127.0.0.1:8795/new/api/archive-review?source='+source)
 if review.get('error'):print('S9_HUMAN_REVIEW',source,'unavailable',review['error']);continue
 clips=review.get('clips') if isinstance(review.get('clips'),dict) else {}
 checks=Counter(str((v or {}).get('label') or 'unreviewed') for v in clips.values())
 print('S9_HUMAN_REVIEW',source,json.dumps({'total_review_records':len(clips),
   'labels':dict(checks),'verified_people_clips':review.get('verified_people_clips')},sort_keys=True))
state={'v9_active':cam.get('motion_detector')=='person_spatiotemporal_transport_v9',
  'real_world_accuracy_benchmark_complete':False,
  'vehicle_pedestrian_confusion_benchmark_complete':False,
  'why':'Live human-ground-truth paired v8/v9 playback detections not yet available'}
print('S9_V9_FIELD_VALIDATION_VERDICT',json.dumps(state,sort_keys=True))
