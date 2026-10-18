#!/usr/bin/env python3
"""Read-only evidence quality watchdog for S9+ appearance/face/pose reviews.

This writes aggregate runtime and measurement-coverage counters only.
It reads the local archive/review contracts without changing reviews or media.
"""
import collections,datetime,json,os,pathlib,tempfile,urllib.request
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
OUT=BASE/"state/s9-recognition-evidence-health.json"

def read(port,path):
 with urllib.request.urlopen("http://127.0.0.1:"+str(port)+path,timeout=15) as r:
  if r.status!=200:raise RuntimeError("unavailable_"+path)
  blob=r.read(6000001)
  if len(blob)>6000000:raise ValueError("metadata_response_too_large")
  data=json.loads(blob)
  if not isinstance(data,dict) or data.get("ok") is not True:raise ValueError("invalid_metadata_contract")
  return data

def audit():
 phone=read(18808,"/status")
 saved=read(8795,"/new/api/saved")
 review=read(8795,"/new/api/visual-review?limit=1")
 quality=read(8795,"/new/api/evidence-quality")
 rows=saved.get("events",[])
 tracks=[t for e in rows for t in (e.get("anonymous_tracks") or []) if isinstance(t,dict)]
 pose=[t.get("pose_metrics") for t in tracks if isinstance(t.get("pose_metrics"),dict)]
 directional=sum(t.get("image_movement_direction") not in (
  None,"insufficient_samples","stationary_or_uncertain","diagonal") for t in tracks)
 colours=sum(t.get("upper_clothing_colour") not in (None,"uncertain") for t in tracks)
 posture=sum(p.get("posture") not in (None,"unavailable","unknown") for p in pose)
 cadence=sum(isinstance(p.get("cadence_steps_per_minute"),(int,float)) for p in pose)
 face=collections.Counter(e.get("face_review_status") or "not_reported" for e in rows)
 folders=review.get("folders")
 if not isinstance(folders,list):raise ValueError("invalid_manual_review_contract")
 supported=quality.get("supported_face_candidates") if quality.get("source_changed_since_analysis") is False else None
 data={
  "schema":"s9_evidence_coverage_v1",
  "updated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "source":"live_S9_microSD_index_and_onphone_status_only",
  "native_capture_active":bool(phone.get("ok") and phone.get("native_4k_enabled")
                                 and phone.get("mode") in ("watching","recording")),
  "onphone_person_detector":phone.get("garden_person_gate_backend"),
  "onphone_pose_runtime_status":phone.get("pose_review_last_status","not_reported"),
  "onphone_face_runtime":phone.get("face_review_engine","not_reported"),
  "onphone_face_deep_scans_since_restart":phone.get("face_deep_scanned",0),
  "onphone_face_deep_errors_since_restart":phone.get("face_deep_errors",0),
  "onphone_face_backfill_since_restart":phone.get("face_backfill_completed",0),
  "onphone_temperature_c":phone.get("temperature_c"),
  "recordings_indexed":len(rows),
  "tracked_observations":len(tracks),
  "observations_with_colour":colours,
  "observations_with_direction":directional,
  "observations_with_pose_json":len(pose),
  "observations_with_measured_posture":posture,
  "observations_with_measured_gait_cadence":cadence,
  "face_review_status_counts":dict(face),
  "face_supported_candidates":supported,
  "face_quality_source_current":quality.get("source_changed_since_analysis") is False,
  "manual_profile_count_is_not_verified_identity_count":True,
  "confirmed_profiles":sum(isinstance(f,dict) and (not f.get("automatic_appearance_group")
    or type(f.get("approved_clips")) is int and f["approved_clips"]>0) for f in folders),
  "unassigned_appearances":review.get("pending_views"),
  "identity_warning":"Clothing, apparent movement and pose are observational evidence, not identity proof",
  "cannot_infer_person_from_absence_of_frontal_face":True,
 }
 OUT.parent.mkdir(exist_ok=True,parents=True)
 fd,tmp=tempfile.mkstemp(prefix=".s9-evidence-",dir=OUT.parent)
 try:
  with os.fdopen(fd,"w") as f:
   json.dump(data,f,sort_keys=True,indent=2);f.write("\n")
   f.flush();os.fsync(f.fileno())
  os.chmod(tmp,0o600);os.replace(tmp,OUT)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 return data

if __name__=="__main__":
 try:print("S9_FACE_POSE_EVIDENCE_AUDIT",json.dumps(audit(),sort_keys=True),flush=True)
 except Exception as exc:
  print("S9_FACE_POSE_EVIDENCE_AUDIT_DEFER",type(exc).__name__,str(exc)[:120],flush=True)
  raise SystemExit(1)

