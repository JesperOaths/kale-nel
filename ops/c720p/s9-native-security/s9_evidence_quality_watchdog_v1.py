#!/usr/bin/env python3
"""Read-only evidence quality watchdog for S9+ appearance/face/pose reviews.

No images, embeddings or identities leave the camera. This writes ONLY
aggregate model-availability and measurement-coverage counters on the C720P.
All recognition remains non-identifying until a human validates a profile.
"""
import collections,datetime,json,os,pathlib,tempfile,urllib.request
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
OUT=BASE/"state/s9-recognition-evidence-health.json"

def read(port,path):
 with urllib.request.urlopen("http://127.0.0.1:"+str(port)+path,timeout=15) as r:
  if r.status!=200:raise RuntimeError("unavailable_"+path)
  return json.load(r)

def audit():
 phone=read(18808,"/status")
 saved=read(8794,"/new/api/saved")
 folders=read(8794,"/new/api/person-folders")
 rows=saved.get("events",[])
 tracks=[t for e in rows for t in (e.get("anonymous_tracks") or []) if isinstance(t,dict)]
 pose=[t.get("pose_metrics") for t in tracks if isinstance(t.get("pose_metrics"),dict)]
 directional=sum(t.get("image_movement_direction") not in (
  None,"insufficient_samples","stationary_or_uncertain","diagonal") for t in tracks)
 colours=sum(t.get("upper_clothing_colour") not in (None,"uncertain") for t in tracks)
 posture=sum(p.get("posture") not in (None,"unavailable","unknown") for p in pose)
 cadence=sum(isinstance(p.get("cadence_steps_per_minute"),(int,float)) for p in pose)
 face=collections.Counter(e.get("face_review_status") or "not_reported" for e in rows)
 counts=folders.get("summary",{})
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
  "face_supported_candidates":counts.get("face_supported_candidates",0),
  "confirmed_profiles":counts.get("profiles",0),
  "unassigned_appearances":counts.get("unassigned_appearances",0),
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
