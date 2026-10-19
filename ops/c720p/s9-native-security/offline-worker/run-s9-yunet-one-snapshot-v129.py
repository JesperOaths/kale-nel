#!/usr/bin/env python3
"""Read one SHA-qualified real snapshot ON the S9, measure landmarks only.

No JPEG bytes cross ADB. No Camera2 restart, recording writes, new face labels,
human registry writes, or automated identity inference.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

HERE=Path(__file__).resolve().parent
HOME=Path("/home/jespern/c720p-home-hub")
PHONE="192.168.178.250:5555"
WORKER="/data/local/tmp/s9_worker"
LOCK=HOME/"state/s9-v3-archive-backfill.lock"
CATALOG=HOME/"state/s9-standalone-archive-catalog-v1.json"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
MODEL="/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx"
AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
AAR_URL=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
         "onnxruntime-android/1.22.0/onnxruntime-android-1.22.0.aar")
ANDROID_JAR="/usr/lib/android-sdk/platforms/android-36/android.jar"
FILE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg")
SHA=re.compile("[a-f0-9]{64}")
def run(args,timeout=65):
 result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if result.returncode:raise RuntimeError("isolated_phone_worker_failed")
 return result.stdout.strip()
def adb(*args,timeout=22):return run(["adb","-s",PHONE,*args],timeout)
def digest(b):return hashlib.sha256(b).hexdigest()
def check_photo_metadata():
 if CATALOG.is_symlink() or not CATALOG.is_file() or CATALOG.stat().st_size>16*1024*1024:
  raise RuntimeError("trusted_private_catalog_missing")
 data=json.loads(CATALOG.read_text())
 if data.get("schema_version")!="s9_native_archive_catalog_v1":raise RuntimeError("catalog_schema_drift")
 rows=[]
 for name,entry in data.get("records",{}).items():
  if not isinstance(entry,dict) or not re.fullmatch(r"motion_[0-9]{13}[.]mp4",name):continue
  for face in (entry.get("manifest") or {}).get("face_candidates",[]):
   if not isinstance(face,dict) or face.get("face_crop_padded_context_only") is not False:continue
   photo=face.get("snapshot");stamp=face.get("snapshot_sha256");size=face.get("snapshot_size_bytes")
   if (isinstance(photo,str) and FILE.fullmatch(photo)
       and isinstance(stamp,str) and SHA.fullmatch(stamp)
       and type(size) is int and 4000<size<2200000
       and photo.startswith(name[:-4]+"__")):
    rows.append((size,name,photo,stamp))
 if not rows:raise RuntimeError("no_source_qualified_unpadded_face_snapshot")
 _,_,photo,sha=max(rows)
 return photo,sha
def safe_camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as req:
  if req.status!=200:raise RuntimeError("camera_status_unavailable")
  stat=json.loads(req.read(65536))
 if (stat.get("ok") is not True or stat.get("mode")!="watching"
     or stat.get("continuous_4k_ready") is not True
     or stat.get("native_4k_enabled") is not True
     or stat.get("continuous_4k_dropped_output_frames")!=0
     or stat.get("continuous_4k_error")
     or type(stat.get("temperature_c")) not in (float,int)
     or not 0<stat["temperature_c"]<=38.0
     or type(stat.get("continuous_4k_buffered_ms")) is not int
     or stat["continuous_4k_buffered_ms"]<6500
     or any(stat.get(k) is True for k in
        ("recording_active","recording_in_progress","face_backfill_queued",
         "appearance_backfill_queued","movement_4k_backfill_queued"))):
  raise RuntimeError("capture_busy_or_thermally_unsafe")
 return stat
def phone_sha(path):
 res=adb("shell","sha256sum "+path)
 tok=res.split()
 if len(tok)<2 or not SHA.fullmatch(tok[0]):raise RuntimeError("unknown_phone_hash")
 return tok[0]
def build(folder):
 jar=folder/"ort.aar"
 with urllib.request.urlopen(AAR_URL,timeout=45) as r:
  if r.status!=200:raise RuntimeError("ort_source_unavailable")
  data=r.read(30000001)
 if len(data)>30000000 or digest(data)!=AAR_SHA:raise RuntimeError("official_ort_sha_drift")
 jar.write_bytes(data)
 with zipfile.ZipFile(jar) as z:
  (folder/"ort.jar").write_bytes(z.read("classes.jar"))
 classes=folder/"classes";classes.mkdir()
 sources=[HERE/x for x in ("S9YuNetOneSnapshotMeasure.java",
                            "PhoneYuNetLandmarkDecoder.java",
                            "PhoneFaceLandmarkGate.java")]
 if any(not p.is_file() or p.is_symlink() for p in sources):raise RuntimeError("untrusted_worker_source")
 if not Path(ANDROID_JAR).is_file():raise RuntimeError("android_sdk_missing")
 run(["javac","-source","8","-target","8","-cp",str(folder/"ort.jar")+":"+ANDROID_JAR,
      "-d",str(classes),*(str(s) for s in sources)],timeout=80)
 dex=folder/"dex";dex.mkdir()
 run(["d8","--min-api","29","--output",str(dex),str(folder/"ort.jar"),
      *(str(f) for f in sorted(classes.rglob("*.class")))],timeout=110)
 raw=(dex/"classes.dex").read_bytes()
 if not 2000<len(raw)<1500000:raise RuntimeError("invalid_dex_blob")
 out=folder/"one-face.jar"
 with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
  info=zipfile.ZipInfo("classes.dex",date_time=(2020,1,1,0,0,0))
  info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o600<<16
  z.writestr(info,raw)
 return out
def on_phone(jar,photo,sha):
 data=jar.read_bytes();target=WORKER+"/s9-yunet-real-screen-"+digest(data)[:16]+".jar"
 # Immutable private standalone DEX: refuse any unexpected pre-existing file.
 prior=subprocess.run(["adb","-s",PHONE,"shell","test -e "+target],
                      capture_output=True,text=True,timeout=15)
 if prior.returncode==0:
  if phone_sha(target)!=digest(data):raise RuntimeError("existing_worker_dex_mismatch")
 elif prior.returncode==1 and not prior.stderr.strip():
  part=target+".pending"
  test=subprocess.run(["adb","-s",PHONE,"shell","test -e "+part],
                      capture_output=True,text=True,timeout=15)
  if test.returncode!=1 or test.stderr.strip():raise RuntimeError("unknown_phone_partial")
  run(["adb","-s",PHONE,"push",str(jar),part],timeout=45)
  if phone_sha(part)!=digest(data):raise RuntimeError("unverified_dex_stage")
  adb("shell","mv "+part+" "+target+" && chmod 600 "+target)
  if phone_sha(target)!=digest(data):raise RuntimeError("unverified_dex_final")
 else:raise RuntimeError("phone_dex_presence_ambiguous")
 safe_camera()
 command=("export LD_LIBRARY_PATH="+WORKER+"/lib; "
          "export CLASSPATH="+target+"; "
          "app_process -Djava.library.path="+WORKER+"/lib /system/bin "+
          "nl.kalenel.s9offline.S9YuNetOneSnapshotMeasure --one "+
          photo+" "+sha)
 output=adb("shell",command,timeout=85)
 lines=[x.split("S9_YUNET_REAL_SINGLE_SNAPSHOT_SCREEN ",1)[1]
        for x in output.splitlines() if x.startswith("S9_YUNET_REAL_SINGLE_SNAPSHOT_SCREEN ")]
 if len(lines)!=1:raise RuntimeError("phone_landmark_test_unverified")
 result=json.loads(lines[0])
 if (result.get("model_valid") is not True or result.get("sha_qualified_image") is not True
     or result.get("identity_assigned") is not False or result.get("images_written") is not False
     or type(result.get("detected_faces")) is not int or not 0<=result["detected_faces"]<=4
     or type(result.get("five_point_candidate")) is not bool):
  raise RuntimeError("untrusted_face_alignment_result")
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 a=p.parse_args()
 if not LOCK.parent.is_dir() or LOCK.is_symlink():raise RuntimeError("unsafe_phone_lock")
 if shutil.disk_usage("/").free<850*1024*1024:raise RuntimeError("hub_disk_reserve_low")
 with LOCK.open("a+") as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:
   print("S9_YUNET_REAL_SNAPSHOT_DEFERRED "+json.dumps({"reason":"worker_busy"}));return
  try:
   before=safe_camera()
   image,photo_sha=check_photo_metadata()
   if not a.apply:
    print("S9_YUNET_REAL_SNAPSHOT_PREFLIGHT "+json.dumps({"one_image_ready":True,"images_read":0}))
    return
   pid=adb("shell","pidof nl.kalenel.s9security")
   if not pid.isdigit():raise RuntimeError("untrusted_camera_pid")
   if phone_sha(MODEL)!=MODEL_SHA:raise RuntimeError("phone_model_not_verifiable")
   with tempfile.TemporaryDirectory(prefix="s9-yunet-one-") as t:
    result=on_phone(build(Path(t)),image,photo_sha)
   after=safe_camera()
   if adb("shell","pidof nl.kalenel.s9security")!=pid:raise RuntimeError("camera_pid_changed")
   print("S9_YUNET_REAL_ONE_SNAPSHOT_SCREENED "+json.dumps({
     "native_landmark_candidate_found":result["five_point_candidate"],
     "bounded_detector_face_count":result["detected_faces"],
     "temperature_before_c":before["temperature_c"],"temperature_after_c":after["temperature_c"],
     "snapshots_tested":1,"originals_modified":False,"face_snapshots_modified":False,
     "manual_assignments_modified":False,"automatic_person_assignments":0,
     "camera_apk_modified":False,"biometric_vectors_transferred":False},sort_keys=True))
  except RuntimeError as e:
   if str(e) in ("capture_busy_or_thermally_unsafe","no_source_qualified_unpadded_face_snapshot",
                 "trusted_private_catalog_missing","hub_disk_reserve_low"):
    print("S9_YUNET_REAL_SNAPSHOT_DEFERRED "+json.dumps({"reason":str(e),"snapshots_tested":0}))
    return
   raise
if __name__=="__main__":main()
