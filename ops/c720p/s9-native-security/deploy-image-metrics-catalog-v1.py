#!/usr/bin/env python3
"""Expose only validated screen-space S9 motion evidence in the read-only catalog.

The on-device 4K classifier writes clip-only bbox metrics. This patch adds
only strict numeric allowlisting so the Security folders can show the evidence.
No identities, embeddings, biometric vectors, camera recordings or history
deletion are involved. Roll back when live API or tests fail.
"""
from pathlib import Path
import datetime,importlib.util,os,py_compile,shutil,subprocess,tempfile,time,urllib.request,json
BASE=Path("/home/jespern/c720p-home-hub")
FILE=BASE/"bin/c720p-s9-local-sd-catalog.py"
BACK=BASE/"backups/s9-anonymous-image-metrics-v1"
def run(a,sec=30):
 p=subprocess.run(a,capture_output=True,text=True,timeout=sec)
 if p.returncode:raise RuntimeError("command_failed "+str(a[:4])+":"+p.stderr[-500:])
 return p.stdout
def read_live():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:
  d=json.load(r)
 if not d.get("ok") or not isinstance(d.get("events"),list):
  raise RuntimeError("archive_api_unavailable")
 return len(d["events"])
def test(p):
 spec=importlib.util.spec_from_file_location("catalog_with_2d_proof",str(p))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 row={"id":"Person 1","temporary_track_id":1,
  "first_sample_ms":1000,"last_sample_ms":3000,"sample_count":4,
  "peak_detection_score":.91,"upper_clothing_colour":"blue",
  "image_movement_direction":"image_right",
  "image_speed_body_heights_per_second":.125,
  "image_path_straightness":.88,
  "image_detector_box_aspect_ratio":.33,
  "cross_recording_identity":"not_attempted"}
 manifest={"anonymous_tracking_version":"sampled_box_tracklets_v1",
  "anonymous_track_scope":"this_recording_only","duration_ms":4000,
  "anonymous_track_count":1,"anonymous_tracks":[row]}
 d=module.anonymous_clip_metadata(manifest)["anonymous_tracks"][0]
 assert d["image_speed_body_heights_per_second"]==.125
 assert d["image_path_straightness"]==.88
 assert d["image_detector_box_aspect_ratio"]==.33
 assert "gait" in d["gait_cadence_status"]
 assert d["body_posture_status"]=="not_measured_no_pose_keypoints"
 row["image_speed_body_heights_per_second"]=float("nan")
 row["image_path_straightness"]=1.9
 row["image_detector_box_aspect_ratio"]=99.
 d=module.anonymous_clip_metadata(manifest)["anonymous_tracks"][0]
 assert d["image_speed_body_heights_per_second"] is None
 assert d["image_path_straightness"] is None
 assert d["image_detector_box_aspect_ratio"] is None
def main():
 if not FILE.is_file() or FILE.is_symlink():raise RuntimeError("catalog_target_invalid")
 old=FILE.read_text()
 marker="def anonymous_clip_metadata(manifest):"
 original='    "body_posture_status":"not_measured_no_pose_keypoints",\n    "gait_cadence_status":"not_measurable_from_sampled_frames"})'
 if "def safe_image_track_metric" in old:
  print("S9_2D_METRICS_ALREADY_ALLOWLISTED");return
 if old.count(marker)!=1 or old.count(original)!=1:
  raise RuntimeError("unexpected_catalog_schema__no_changes")
 patch='''def safe_image_track_metric(value,maximum):
 if isinstance(value,bool) or not isinstance(value,(float,int)):return None
 value=float(value)
 return round(value,3) if math.isfinite(value) and 0<=value<=maximum else None

'''
 inserted='''    "image_speed_body_heights_per_second":safe_image_track_metric(
      entry.get("image_speed_body_heights_per_second"),8),
    "image_path_straightness":safe_image_track_metric(
      entry.get("image_path_straightness"),1),
    "image_detector_box_aspect_ratio":safe_image_track_metric(
      entry.get("image_detector_box_aspect_ratio"),6),
    "movement_measurement_scope":"clip_scoped_2d_camera_image_not_physical_speed",
'''
 updated=old.replace(marker,patch+marker,1).replace(original,inserted+original,1)
 assert "import math" in updated or ",math" in updated
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 tmp=FILE.with_name(FILE.name+".2d-proof-candidate.py")
 try:
  tmp.write_text(updated)
  py_compile.compile(str(tmp),doraise=True)
  test(tmp)
  initial=read_live()
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  backup=BACK/(stamp+".py");shutil.copy2(FILE,backup)
  os.chmod(backup,0o600)
  os.replace(tmp,FILE)
  try:
   run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
   for i in range(25):
    try:
     remaining=read_live()
     if remaining>=initial:break
    except Exception:pass
    time.sleep(.6)
   else:raise RuntimeError("archive_rows_lost_or_unavailable")
   print("S9_2D_SAFE_CATALOG_METRICS_LIVE",{"before":initial,
     "after":remaining,"rollback":str(backup),"biometric_vectors_excluded":True},flush=True)
  except BaseException:
   shutil.copy2(backup,FILE)
   try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"])
   except Exception:pass
   raise
 finally:tmp.unlink(missing_ok=True)
if __name__=="__main__":main()
