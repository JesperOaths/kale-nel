#!/usr/bin/env python3
"""Read-only person trigger evidence snapshot; no video data transferred or modified."""
import json,urllib.request,collections,datetime
def read(path,timeout=12):
 with urllib.request.urlopen(path,timeout=timeout) as r:return json.load(r)
s=read('http://127.0.0.1:18808/status')
i=read('http://127.0.0.1:8795/new/api/saved')
keys=['ok','mode','motion_detector','garden_zone','frames','recorded','motion_events',
'garden_person_gate_ready','garden_person_gate_backend','garden_person_gate_checked',
'garden_person_gate_matches','garden_person_gate_confirmed_starts','garden_person_gate_rejected',
'garden_person_gate_errors','garden_person_gate_stale_dropped','garden_person_gate_last_score',
'temperature_c','sd_free_bytes','garden_archive_quarantined_since_start',
'garden_archive_preserved_since_start','garden_archive_triage_errors','capture_segment_auto_resume_attempts']
events=[e for e in i.get('events',[]) if str(e.get('clip_no','')).startswith('motion_')]
events.sort(key=lambda e:e.get('clip_no',''),reverse=True)
def group(rows):
 out={'n':len(rows),'events':dict(collections.Counter(str(e.get('person_event_category','missing')) for e in rows)),
 'scenes':dict(collections.Counter(str(e.get('scene_category','missing')) for e in rows)),
 'reviewed':sum(e.get('human_reviewed') is True for e in rows),
 'zero_person':sum(int(e.get('person_count') or 0)==0 for e in rows),
 'person_peak_gt_05':sum(float(e.get('person_confidence') or 0)>=.50 for e in rows),
 'capture_segments':dict(collections.Counter(str(e.get('capture_segment_transition','missing')) for e in rows))}
 return out
out={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
'status':{k:s.get(k) for k in keys},'all':group(events),'latest_30':group(events[:30]),
'latest_100':group(events[:100]),
'archive_mode':i.get('archive_mode'),
'newest_12':[{'clip':e.get('clip_no'),'person_count':e.get('person_count'),
'person_event_category':e.get('person_event_category'),
'person_frames':e.get('person_frames_at_050'),'sampled_frames':e.get('sampled_frame_count'),
'confidence':e.get('person_confidence'),
'transition':e.get('capture_segment_transition')} for e in events[:12]]}
print('S9_PERSON_TRIGGER_AUDIT',json.dumps(out,sort_keys=True),flush=True)
