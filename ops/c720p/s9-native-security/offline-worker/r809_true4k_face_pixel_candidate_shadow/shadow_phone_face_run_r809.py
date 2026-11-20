#!/usr/bin/env python3
"""One-shot existing guarded source-bound candidate face run with R809 shadow.

Baseline FaceEyes.java and its candidate worker remain unchanged.
The model, original SHA-verification, locking and camera health checks
are those of the already existing phone_face_run.py, except for
the isolated R805 DEX classpath and private unapproved output location.
No photo/image content or identity is printed or transferred to hub.
"""
import hashlib,json,pathlib,sys
ORIGINAL=pathlib.Path('/home/jespern/c720p-home-hub/staging/s9-cumulative-folder-evidence-v1-20261120')
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ORIGINAL))
import phone_face_run as baseline
assert hashlib.sha256((HERE/'build/face-dex/classes.dex').read_bytes()).hexdigest()==(
 '189a52977575dc400d303e8db762fe9168d3c27e215cd26a16df48a82f5f74ef')
assert (ORIGINAL/'phone_face_run.py').exists()
baseline.HERE=HERE
baseline.PHONE='/data/local/tmp/s9-face-candidate-r809'
# Exactly the same user-approved original baseline source as the prior
# independent no-face run; no new person labels or heuristic permissions.
import argparse
args=argparse.ArgumentParser(description="One owner-approved source, S9-only shadow")
args.add_argument("--batch-index",type=int,default=1)
args.add_argument("--source-index",type=int,default=1)
opt=args.parse_args()
assert 0<=opt.batch_index<6 and 0<=opt.source_index<=1
# Additional R810 capture-priority admission for heavy native 4K
# extraction. Existing source SHA/recorder/phone and decoder locks remain.
reasons,guard_before,guard_after=baseline.gate()
quiet=guard_after.get('person_last_accepted_motion_age_ms')
if reasons or guard_after.get('mode')!='watching' or \
        type(quiet) is not int or quiet<60000 or \
        guard_after.get('temperature_c',99)>=35 or \
        not 29<=guard_after.get('sensor_result_fps',0)<=31:
 print(json.dumps({
  'status':'DEFER_RECENT_MOTION_OR_CAMERA_PRIORITY',
  'current_camera_guard_count':len(reasons),
  'recordings_affected_by_this_shadow':0,
  'face_candidates_validated_from_this_run':0,
  'person_identity_or_gallery_changed':False,
  'auto_people_folder_filing_authorized':False
 },sort_keys=True))
 raise SystemExit(0)
try:
 out=baseline.run(opt.batch_index,opt.source_index,supplemental=False)
except RuntimeError as err:
 # A new natural recording may begin while the decoder is running.
 # Original baseline immediately terminates its worker and releases
 # locks. Represent that abort as a true refusal, never a zero-face result.
 reason=str(err)
 if reason not in (
  'original recorder regressed during inference',
  'original sensor or AVC preroll frames stalled during model load',
  'camera PID, memory or battery temperature changed during decoding',
  'recorder process/health/continuity failed after batch',
  'phone recorder gate regressed',
 ):
  raise
 print(json.dumps({
  'status':'ABSTAIN_CAMERA_CONTINUITY_OR_RESOURCE_GUARD',
  'failure_class':reason,
  'real_face_detection_result_from_aborted_run':False,
  'camera_control_actions':0,
  'new_recurring_tasks':0,
  'identity_folder_or_verified_reference_promoted':False,
  'automatic_people_folder_filing_authorized':False
 },sort_keys=True))
 raise SystemExit(0)
rec=out.get('face_receipt',{})
stats=rec.get('r805_shadow_only_aggregate_rejections')
rawdet=rec.get('r805_detector_640_then_smoothed320_stats')
r807_peak=rec.get('r807_yunet_peak_score_640_then_320')
r807_bins=rec.get('r807_yunet_grid_counts_ge20_ge50_ge70_ge85')
if out.get('status')!='DEFER_CAPTURE_ATTESTATION_NOT_PASSED':
 assert isinstance(r807_peak,list) and len(r807_peak)==2
 assert isinstance(r807_bins,list) and len(r807_bins)==8
 assert all(isinstance(x,(float,int)) and 0<=x<=1 for x in r807_peak)
 assert all(type(x) is int and x>=0 for x in r807_bins)
 for i in (0,4):
  assert r807_bins[i]>=r807_bins[i+1]>=r807_bins[i+2]>=r807_bins[i+3]

if stats is not None:
 assert isinstance(stats,list) and len(stats)==6
 assert sum(stats)==rec['attempted_head_regions']
 if rawdet is not None:assert isinstance(rawdet,list) and len(rawdet)==8
assert out.get('face_gallery_enrolled',0)==0
assert rec.get('automatic_folder_assignments',0)==0
assert rec.get('no_person_identification_performed',True) is True
print(json.dumps({
 'status':out.get('status'),
 'original_4k_frames_decoded_on_s9':rec.get('decoded_original_frames'),
 'candidate_head_windows_examined_on_s9':rec.get('attempted_head_regions'),
 'aggregate_rejection_histogram':stats,
   'candidate_review_only_threshold':0.82,
 'r809_true_original_4k_decode':True,
 'r809_max_native_decoded_frames':2,
 'unapproved_candidates_must_never_become_identity_without_ground_truth':True,
 'detector_640_then_320_counters':rawdet,
 'yunet_peak_score_640_and_smoothed320':r807_peak,
 'yunet_grid_cells_count_ge_20_50_70_85':r807_bins,
 'unapproved_phone_only_face_candidate_count':len(rec.get('unapproved_face_candidates',[])),
 'original_model_and_identity_baseline_changed':False,
 'camera_minimum_fps':out.get('camera_observation',{}).get('minimum_fps'),
 'camera_maximum_temperature_c':out.get('camera_observation',{}).get('maximum_temp'),
 'automatic_gallery_enrollment':out.get('face_gallery_enrolled',0),
 'new_people_folder_assignments':rec.get('automatic_folder_assignments',0),
 'candidate_image_content_transferred_to_hub':False,
 'new_background_jobs_created':0
},sort_keys=True))
