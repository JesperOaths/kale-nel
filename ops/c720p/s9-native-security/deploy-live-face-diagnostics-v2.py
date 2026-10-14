#!/usr/bin/env python3
"""Guarded, additive S9 4K face-review diagnostics on the LIVE C720P catalog.

Keep newer on-phone face-capture quality semantics already deployed in this
installation; do not replace the full catalog or expose biometric templates.
"""
from pathlib import Path
import datetime,importlib.util,json,os,py_compile,shutil,subprocess,tempfile,time,urllib.request
HOME=Path("/home/jespern/c720p-home-hub")
TARGET=HOME/"bin/c720p-s9-local-sd-catalog.py"
BACK=HOME/"backups/s9-face-v2-catalog-diagnostics"
ANCHOR=' rows=m.get("face_candidates")'
PATCH=''' # Numeric evidence about the phone's own verified 4K review.
 # This is never evidence of a person's identity or physical gait.
 prior=m.get("face_deep_review_version")
 if prior=="s9_onphone_36_samples_person_roi_v2" and n==36:
  result["face_deep_review_version"]=prior
 outcome=m.get("face_evidence_outcome")
 result["face_evidence_outcome"]=outcome if outcome in (
  "snapshot_candidates_saved","review_processing_failed",
  "no_face_detector_hit_in_sampled_frames",
  "face_candidates_rejected_in_sampling") else "legacy_review_no_diagnostics"
 state=m.get("face_model_state")
 result["face_model_state"]=state if state in (
  "not_tested_no_usable_face","available_on_phone","unavailable_on_phone") else "not_available"
 for key in ("face_detector_raw_hits","face_rejected_confidence_or_size",
   "face_rejected_looking_away_or_roll","face_rejected_crop_geometry",
   "face_rejected_dark_or_blurry"):
  val=m.get(key)
  result[key]=val if type(val) is int and 0<=val<=144 else None
 for key in ("face_deep_detector_anchor_frames","face_deep_person_roi_anchors",
   "face_deep_multiple_person_anchors","face_deep_multiscale_refinement_passes"):
  val=m.get(key)
  result[key]=val if (prior=="s9_onphone_36_samples_person_roi_v2"
   and type(val) is int and 0<=val<=12) else None
'''
def run(cmd,timeout=30):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed_"+str(cmd[:3])+":"+p.stderr[-320:])
 return p.stdout
def count():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=13) as stream:
  obj=json.load(stream)
 if obj.get("ok") is not True or not isinstance(obj.get("events"),list):
  raise RuntimeError("archive_unhealthy")
 return len(obj["events"])
def verify_module(p):
 spec=importlib.util.spec_from_file_location("s9_live_face_diagnostics_v2",str(p))
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 row={"face_review_version":"s9_face_review_v1","face_review_sampled_frames":36,
      "face_review_status":"no_frontal_face_in_samples",
      "face_deep_review_version":"s9_onphone_36_samples_person_roi_v2",
      "face_evidence_outcome":"face_candidates_rejected_in_sampling",
      "face_model_state":"not_tested_no_usable_face",
      "face_detector_raw_hits":5,"face_deep_person_roi_anchors":8,
      "face_capture_algorithm":"person_head_roi_face_evidence_v2",
      "face_candidates":[],"embedding":[.1]*128}
 out=mod.safe_face_review_metadata(row)
 assert out["face_deep_review_version"]=="s9_onphone_36_samples_person_roi_v2"
 assert out["face_evidence_outcome"]=="face_candidates_rejected_in_sampling"
 assert out["face_deep_person_roi_anchors"]==8
 assert out["face_capture_algorithm"]=="person_head_roi_face_evidence_v2"
 assert "embedding" not in out
 row["face_detector_raw_hits"]=True;row["face_deep_person_roi_anchors"]=500
 out=mod.safe_face_review_metadata(row)
 assert out["face_detector_raw_hits"] is None
 assert out["face_deep_person_roi_anchors"] is None
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("live_catalog_path_invalid")
 old=TARGET.read_text()
 if 'result["face_evidence_outcome"]=outcome' in old:
  print("S9_FACE_DIAGNOSTICS_V2_ALREADY_PRESENT");return
 if old.count(ANCHOR)!=1 or "face_capture_algorithm" not in old:
  raise RuntimeError("unknown_catalog_schema_refuse_replace")
 new=old.replace(ANCHOR,PATCH+ANCHOR,1)
 targettmp=TARGET.with_name(".s9-face-v2-catalog-verify.py")
 if targettmp.exists():raise RuntimeError("stale_candidate_detected")
 try:
  targettmp.write_text(new)
  py_compile.compile(str(targettmp),doraise=True)
  verify_module(targettmp)
  initial=count()
  BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  backup=BACK/(stamp+".py");shutil.copy2(TARGET,backup);os.chmod(backup,0o600)
  targettmp.chmod(TARGET.stat().st_mode&0o777)
  os.replace(targettmp,TARGET)
  try:
   run(["systemctl","--user","restart","c720p-drive-security-archive.service"],35)
   for _ in range(25):
    try:
     after=count()
     if after>=initial:break
    except Exception:pass
    time.sleep(.8)
   else:raise RuntimeError("archive_rows_lost_or_status_unavailable")
   verify_module(TARGET)
   print("S9_FACE_V2_DIAGNOSTICS_CATALOG_LIVE",{
     "recordings_before":initial,"recordings_after":after,
     "backup":str(backup),"source_mp4_modified":False,
     "identity_or_biometric_templates_exported":False},flush=True)
  except BaseException:
   shutil.copy2(backup,TARGET)
   try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],35)
   except Exception:pass
   raise
 finally:targettmp.unlink(missing_ok=True)
if __name__=="__main__":main()
