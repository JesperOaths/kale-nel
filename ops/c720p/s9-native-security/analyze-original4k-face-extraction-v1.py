#!/usr/bin/env python3
"""Next-stage, non-identifying face-extraction quality and gap analysis.

Read only sanitized archive metadata. Distinguish complete sampling, available
images and remaining source-quality limitations; none establish identity or
prove that no person appeared. No image/vector reads, inference or writes.
"""
from collections import Counter
import json
import re
import urllib.request

VERSION='s9_original4k_face_extraction_analysis_v1'
TARGET='s9_onphone_36_samples_overlapping_tiles_v5'
CLIP=re.compile(r'motion_[0-9]{13}[.]mp4')
SNAP=re.compile(r'motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg')

def count(row,key):
 value=row.get(key)
 return value if type(value) is int and 0<=value<=100000 else 0

def analyze(archive):
 if archive.get('archive_mode')!='S9-microSD-only' or not isinstance(archive.get('events'),list):
  raise ValueError('original_archive_unavailable')
 cohorts=Counter();quality=Counter();seen=set();images=set()
 candidates=missing=invalid=manual=0
 supported_without_images=0
 reviewed=0
 for row in archive['events']:
  if not isinstance(row,dict) or not CLIP.fullmatch(str(row.get('clip_no',''))):continue
  name=row['clip_no']
  if name in seen:raise ValueError('duplicate_original_recording')
  seen.add(name)
  faces=row.get('face_candidates')
  if not isinstance(faces,list) or len(faces)>16:raise ValueError('invalid_candidate_list')
  local=set()
  for face in faces:
   if not isinstance(face,dict):raise ValueError('invalid_candidate')
   candidates+=1
   snap=face.get('snapshot_name')
   if not snap:missing+=1;continue
   if not isinstance(snap,str) or not SNAP.fullmatch(snap) or not snap.startswith(name[:-4]+'__'):
    invalid+=1;continue
   local.add(snap);images.add(snap)
   if face.get('face_crop_requires_manual_review') is True or face.get('face_crop_padded_context_only') is True:
    manual+=1
  for key in ('face_rejected_insufficient_native_eye_detail','face_rejected_dark_or_blurry',
              'face_rejected_crop_geometry','face_detector_raw_hits'):
   quality[key]+=count(row,key)
  current=row.get('face_deep_review_version')==TARGET
  reviewed+=current
  if not current:stage='awaiting_current_original4k_pass'
  elif local:stage='saved_images_available_for_manual_review'
  elif count(row,'face_rejected_insufficient_native_eye_detail'):stage='no_saved_image_insufficient_native_detail'
  elif count(row,'face_rejected_dark_or_blurry'):stage='no_saved_image_dark_or_blurry'
  elif count(row,'face_detector_raw_hits'):stage='no_saved_image_candidates_rejected'
  else:stage='no_face_hit_in_sampled_frames'
  cohorts[stage]+=1
  if not local and count(row,'person_track_count')>0:supported_without_images+=1
 if not seen:raise ValueError('no_original_recordings')
 return {'analysis_version':VERSION,'source_original_recordings':len(seen),
  'current_v5_reviewed':reviewed,'remaining_v5_reviews':len(seen)-reviewed,
  'all_originals_current_v5':reviewed==len(seen),'candidate_records':candidates,
  'unique_indexed_images':len(images),'candidate_records_without_image':missing,
  'invalid_image_references':invalid,'inspection_only_image_records':manual,
  'recording_extraction_cohorts':dict(cohorts),
  'person_supported_recordings_without_saved_face_image':supported_without_images,
  'latest_scan_rejection_observations':dict(quality),
  'rejection_observations_are_not_unique_people_or_unique_frames':True,
  'sampling_complete_is_not_detector_accuracy_validation':True,
  'no_saved_face_is_not_evidence_of_no_person':True,
  'snapshot_file_availability_checked':False,'identity_inference_performed':False,
  'original_recordings_modified':False,'review_decisions_modified':False}

def main():
 with urllib.request.urlopen('http://127.0.0.1:8795/new/api/saved',timeout=25) as r:
  if r.status!=200:raise RuntimeError('archive_http_unavailable')
  raw=r.read(6000001)
 if len(raw)>6000000:raise RuntimeError('metadata_size_exceeded')
 print('S9_ORIGINAL4K_FACE_EXTRACTION_ANALYSIS',json.dumps(analyze(json.loads(raw)),sort_keys=True),flush=True)
if __name__=='__main__':main()
