#!/usr/bin/env python3
"""Guarded addition of bounded S9 face-review diagnostics to the archive API.

The on-phone face classifier and indexed source MP4s stay unchanged. No
embedding, raw image, identity linkage or physical gait is exposed.
"""
from pathlib import Path
import datetime,json,os,py_compile,shutil,subprocess,tempfile,time,urllib.request
HOME=Path("/home/jespern/c720p-home-hub")
TARGET=HOME/"bin/s9_sd_proxy_extension.py"
BACK=HOME/"backups/s9-face-v2-api-diagnostics"
ANCHOR='      "face_snapshots_saved":r.get("face_snapshots_saved",0),'
HELPER='''def bounded_face_counter(r,key,maximum):
 value=r.get(key)
 return value if type(value) is int and 0<=value<=maximum else None

def safe_face_outcome(r):
 value=r.get("face_evidence_outcome")
 return value if value in (
  "snapshot_candidates_saved","review_processing_failed",
  "no_face_detector_hit_in_sampled_frames",
  "face_candidates_rejected_in_sampling",
  "legacy_review_no_diagnostics","not_reviewed") else "not_available"

def safe_face_model_state(r):
 value=r.get("face_model_state")
 return value if value in (
  "not_tested_no_usable_face","available_on_phone",
  "unavailable_on_phone","not_available") else "not_available"

'''
INSERT='''      "face_evidence_outcome":safe_face_outcome(r),
      "face_model_state":safe_face_model_state(r),
      "face_detector_raw_hits":bounded_face_counter(r,"face_detector_raw_hits",144),
      "face_rejected_confidence_or_size":bounded_face_counter(r,"face_rejected_confidence_or_size",144),
      "face_rejected_looking_away_or_roll":bounded_face_counter(r,"face_rejected_looking_away_or_roll",144),
      "face_rejected_crop_geometry":bounded_face_counter(r,"face_rejected_crop_geometry",144),
      "face_rejected_dark_or_blurry":bounded_face_counter(r,"face_rejected_dark_or_blurry",144),
      "face_deep_detector_anchor_frames":bounded_face_counter(r,"face_deep_detector_anchor_frames",12),
      "face_deep_person_roi_anchors":bounded_face_counter(r,"face_deep_person_roi_anchors",12),
      "face_deep_multiple_person_anchors":bounded_face_counter(r,"face_deep_multiple_person_anchors",12),
      "face_deep_multiscale_refinement_passes":bounded_face_counter(r,"face_deep_multiscale_refinement_passes",12),
'''
def read_archive():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as response:
  data=json.load(response)
 if not data.get("ok") or not isinstance(data.get("events"),list):
  raise RuntimeError("archive_not_healthy")
 return data["events"]
def run(cmd):
 p=subprocess.run(cmd,text=True,capture_output=True,timeout=35)
 if p.returncode:raise RuntimeError("service_restart_failed_"+p.stderr[-300:])
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("proxy_target_invalid")
 old=TARGET.read_text()
 if '"face_detector_raw_hits":bounded_face_counter(' in old:
  print("S9_FACE_API_V2_ALREADY_PRESENT");return
 if old.count(ANCHOR)!=1 or old.count("def install_local_sd(H):")!=1:
  raise RuntimeError("proxy_contract_changed_no_update")
 candidate=old.replace("def install_local_sd(H):",HELPER+"def install_local_sd(H):",1)
 candidate=candidate.replace(ANCHOR,INSERT+ANCHOR,1)
 before=read_archive()
 t=TARGET.with_name(".s9-face-api-v2-verify.py")
 if t.exists():raise RuntimeError("stale_candidate")
 try:
  t.write_text(candidate)
  py_compile.compile(str(t),doraise=True)
  BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  backup=BACK/(stamp+".py");shutil.copy2(TARGET,backup);os.chmod(backup,0o600)
  t.chmod(TARGET.stat().st_mode&0o777)
  os.replace(t,TARGET)
  try:
   run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
   for _ in range(25):
    try:
     after=read_archive()
     if len(after)>=len(before) and all("face_evidence_outcome" in x for x in after[:2]):break
    except Exception:pass
    time.sleep(.8)
   else:raise RuntimeError("api_missing_or_archive_count_lost")
   scanned=[x for x in after if x.get("face_deep_review_version")=="s9_onphone_36_samples_person_roi_v2"]
   print("S9_FACE_V2_DIAGNOSTIC_API_LIVE",{
     "recordings_before":len(before),"recordings_after":len(after),
     "v2_visible":len(scanned),
     "outcomes":[x.get("face_evidence_outcome") for x in scanned[:5]],
     "face_snapshots_saved":sum(x.get("face_snapshots_saved") or 0 for x in after),
     "backup":str(backup),"biometric_templates_exported":False},flush=True)
  except BaseException:
   shutil.copy2(backup,TARGET)
   try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
   except Exception:pass
   raise
 finally:t.unlink(missing_ok=True)
if __name__=="__main__":main()
