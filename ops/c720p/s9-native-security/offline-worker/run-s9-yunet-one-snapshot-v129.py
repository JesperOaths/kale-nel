#!/usr/bin/env python3
"""One face-crop detector audit, Android ONNX Runtime executed ONLY on S9+.

All camera and review files are read-only, one JPEG of a bounded already
manifested candidate, no enrollment/no aligned crop/no automatic identity.
Thermal guard, shared backfill lock, protected 4K recorder PID before/after.
"""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

BASE=Path(__file__).resolve().parent
PHONE="192.168.178.250:5555"
WORKER="/data/local/tmp/s9_worker"
LIBS=WORKER+"/lib"
MODEL="/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
AAR=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
     "onnxruntime-android/1.22.0/onnxruntime-android-1.22.0.aar")
AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
AND_JAR=Path("/usr/lib/android-sdk/platforms/android-36/android.jar")
CATALOG=Path("/home/jespern/c720p-home-hub/state/s9-standalone-archive-catalog-v1.json")
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill.lock")
MARK="S9_YUNET_ONE_FACE_SNAPSHOT_RESULT "
SRC=("S9YuNetSingleSnapshotAudit.java","PhoneYuNetLandmarkDecoder.java",
     "PhoneFaceLandmarkGate.java")
FILE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg")
SHA=re.compile(r"[a-f0-9]{64}")
def digest(blob):return hashlib.sha256(blob).hexdigest()
def call(argv,seconds=90):
 try:p=subprocess.run(argv,capture_output=True,text=True,timeout=seconds)
 except subprocess.TimeoutExpired:
  # TimeoutExpired embeds command arguments, including private JPEG names.
  # Never propagate those arguments to management logs or mark inference valid.
  raise RuntimeError("phone_or_build_operation_timeout_no_private_detail") from None
 if p.returncode:
  # An Android app_process shell launch returning 137 was observed in a real
  # one-snapshot smoke. Treat it as a distinct hard failure; it does not prove
  # OOM, a model result, or a recorder fault. Never log command or phone data.
  if (len(argv)>=5 and argv[0]=="adb" and argv[3]=="shell"
      and isinstance(argv[4],str)
      and re.search(r"(?:^|[; ])app_process(?:\s|$)",argv[4])
      and (p.returncode in (137,-9)
           or re.search(r"\bkilled\b",(p.stderr or "")+" "+(p.stdout or ""),re.I))):
   raise RuntimeError("android_app_process_terminated_without_face_evidence")
  # Never disclose private filenames, image bytes, stack traces, or model
  # tensors. Map ONLY a few well-known Android/runtime failure families.
  if (len(argv)>=5 and argv[0]=="adb" and argv[3]=="shell"
      and isinstance(argv[4],str)
      and re.search(r"(?:^|[; ])app_process(?:\s|$)",argv[4])):
   detail=((p.stderr or "")+"\\n"+(p.stdout or ""))[:12000]
   categories=(
     ("missing_java_class",r"(?:ClassNotFoundException|NoClassDefFoundError|Could not find class)"),
     ("native_library_unavailable",r"(?:UnsatisfiedLinkError|dlopen failed|no onnxruntime in java.library.path)"),
     ("android_storage_denied",r"(?:Permission denied|SecurityException|EACCES)"),
     ("bitmap_decoder_unavailable",r"(?:bitmap_decode_dimensions_drift|BitmapFactory|not_native_square_face_snapshot)"),
     ("model_runtime_exception",r"(?:OrtException|ai[.]onnxruntime|onnxruntime)"),
     ("landmark_geometry_contract",r"(?:missing_yunet_head|unexpected_yunet_head|untrusted_yunet_source_geometry)"),
     ("source_integrity_rejected",r"(?:phone_snapshot_sha256_drift|untrusted_phone_readonly_file|outside_readonly_snapshot_or_model_folder)"),
     ("java_uncategorized_exception",r"(?:Exception in thread|java[.]lang[.]|Caused by:|Error:)"),
   )
   for reason,pattern in categories:
    if re.search(pattern,detail,re.I):
     raise RuntimeError("face_app_process_"+reason+"_unverified") from None
   raise RuntimeError("face_app_process_nonzero_unclassified_unverified") from None
  raise RuntimeError("separate_phone_operation_failed")
 return p.stdout.strip()
def adb(*cmd,timeout=26):
 return call(["adb","-s",PHONE,*cmd],timeout)
def hash_phone(file):
 result=adb("shell","sha256sum "+file,timeout=24)
 tokens=result.split()
 if len(tokens)<2 or not SHA.fullmatch(tokens[0]):
  raise RuntimeError("untrusted_phone_file_digest")
 return tokens[0]
def current_camera():
 req=urllib.request.Request("http://127.0.0.1:18808/status",
    headers={"Cache-Control":"no-cache"})
 with urllib.request.urlopen(req,timeout=11) as resp:
  if resp.status!=200:raise RuntimeError("camera_http_bad_status")
  raw=resp.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_response_oversized")
 info=json.loads(raw)
 if (info.get("ok") is not True or info.get("mode")!="watching"
   or info.get("native_4k_enabled") is not True
   or info.get("continuous_4k_ready") is not True
   or info.get("continuous_4k_production_persisted") is not True
   or info.get("continuous_4k_dropped_output_frames")!=0
   or info.get("continuous_4k_error")
   or type(info.get("temperature_c")) not in (int,float)
   or not 0<info["temperature_c"]<=38.7
   or type(info.get("continuous_4k_buffered_ms")) is not int
   or info["continuous_4k_buffered_ms"]<6500
   or type(info.get("sd_free_bytes")) is not int
   or info["sd_free_bytes"]<20*1024**3
   or any(info.get(key) is True for key in
     ("recording_active","recording_in_progress","garden_person_gate_busy",
     "face_backfill_queued","appearance_backfill_queued","historical_import_queued"))):
  raise RuntimeError("capture_not_cool_idle")
 return info
def select():
 if CATALOG.is_symlink() or not CATALOG.is_file() or CATALOG.stat().st_size>16000000:
  raise RuntimeError("verified_catalog_unavailable")
 catalog=json.loads(CATALOG.read_bytes())
 if catalog.get("schema_version")!="s9_native_archive_catalog_v1":
  raise RuntimeError("unknown_catalog_schema")
 found=[]
 for clip,record in sorted(catalog.get("records",{}).items(),reverse=True):
  if not re.fullmatch(r"motion_[0-9]{13}[.]mp4",clip):continue
  if not isinstance(record,dict):continue
  m=record.get("manifest")
  if not isinstance(m,dict):continue
  images=m.get("face_candidates",[])
  if not isinstance(images,list) or len(images)>16:continue
  for item in images:
   if not isinstance(item,dict):continue
   name=item.get("snapshot");expected=item.get("snapshot_sha256")
   size=item.get("snapshot_size_bytes")
   if (not isinstance(name,str) or not FILE.fullmatch(name)
       or not name.startswith(clip[:-4]+"__") or
       not isinstance(expected,str) or not SHA.fullmatch(expected)
       or type(size) is not int or not 1000<size<2*1024*1024
       or item.get("face_crop_padded_context_only") is True):
    continue
   # Source bitmap is an inspection-only candidate, NEVER an identity proof.
   found.append((name,expected))
   if len(found)>80:break
  if len(found)>80:break
 if not found:raise RuntimeError("no_source_qualified_unpadded_face_snapshot")
 return found[0],len(found)
def build(folder):
 if shutil.disk_usage("/").free<850*1024*1024:
  raise RuntimeError("hub_root_disk_reserve_low")
 if not AND_JAR.is_file() or AND_JAR.is_symlink():
  raise RuntimeError("android_sdk_unavailable")
 files=[BASE/n for n in SRC]
 if any(not f.is_file() or f.is_symlink() for f in files):
  raise RuntimeError("missing_source_qualified_face_code")
 req=urllib.request.Request(AAR,headers={"User-Agent":"S9YunetOneSnapshot/1"})
 with urllib.request.urlopen(req,timeout=40) as response:
  if response.status!=200:raise RuntimeError("pinned_ort_unavailable")
  raw=response.read(30000001)
 if len(raw)>30000000 or digest(raw)!=AAR_SHA:
  raise RuntimeError("onnxruntime_dependency_drift")
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  classes=z.read("classes.jar")
 ort=folder/"ort.jar";ort.write_bytes(classes)
 out=folder/"classes";out.mkdir()
 call(["javac","-source","8","-target","8","-cp",str(AND_JAR)+":"+str(ort),
       "-d",str(out),*[str(f) for f in files]],seconds=65)
 objects=sorted(str(p) for p in out.rglob("*.class"))
 if not 3<=len(objects)<=15:raise RuntimeError("unexpected_compiled_android_classes")
 dex=folder/"dex";dex.mkdir()
 call(["d8","--min-api","28","--lib",str(AND_JAR),
       "--output",str(dex),str(ort),*objects],seconds=95)
 result=folder/"yunet-one-snapshot-v129.jar"
 with zipfile.ZipFile(result,"w",zipfile.ZIP_DEFLATED) as w:
  w.write(dex/"classes.dex","classes.dex")
 if not 2000<result.stat().st_size<2*1024*1024:
  raise RuntimeError("private_worker_jar_outside_bounds")
 return result
def remote_exists(path):
 p=subprocess.run(["adb","-s",PHONE,"shell","test -e "+path],
                 capture_output=True,text=True,timeout=16)
 if p.returncode==0:return True
 if p.returncode==1 and not p.stderr.strip():return False
 raise RuntimeError("remote_path_presence_indeterminate")
def prepare_jar(jar):
 val=digest(jar.read_bytes())
 target=WORKER+"/s9-yunet-one-snapshot-"+val[:16]+".jar"
 if remote_exists(target):
  if hash_phone(target)!=val:
   raise RuntimeError("existing_private_worker_content_drift")
 else:
  partial=target+".pending"
  if remote_exists(partial):raise RuntimeError("unknown_worker_partial")
  adb("push",str(jar),partial,timeout=42)
  if hash_phone(partial)!=val:raise RuntimeError("worker_transfer_sha_mismatch")
  adb("shell","mv "+partial+" "+target+" && chmod 600 "+target)
  if hash_phone(target)!=val:raise RuntimeError("worker_installed_sha_mismatch")
 return target
def execute(one,count,jar,pid):
 name,sha=one
 if hash_phone(MODEL)!=MODEL_SHA:raise RuntimeError("real_yunet_model_not_pinned")
 path=("/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/"
       "files/Security4K/FaceSnapshots/"+name)
 if hash_phone(path)!=sha:
  raise RuntimeError("phone_face_snapshot_manifest_digest_mismatch")
 current_camera()
 if adb("shell","pidof nl.kalenel.s9security")!=pid:
  raise RuntimeError("camera_pid_changed_before_one_snapshot")
 remote=prepare_jar(jar)
 # shell process reads ONE exact SHA-verified JPEG. Only aggregate true/false
 # landmark eligibility is emitted, no image, filename, vector or identity.
 script=("export LD_LIBRARY_PATH="+LIBS+"; export CLASSPATH="+remote+"; "+
         "app_process -Djava.library.path="+LIBS+" /system/bin "+
         "nl.kalenel.s9offline.S9YuNetSingleSnapshotAudit "+
         "--audit-single "+name+" "+sha)
 result=adb("shell",script,timeout=110)
 hits=[x[len(MARK):] for x in result.splitlines() if x.startswith(MARK)]
 if len(hits)!=1:raise RuntimeError("one_snapshot_runtime_marker_missing")
 doc=json.loads(hits[0])
 if not (doc.get("detector_executed_on_phone") is True
     and doc.get("source_image_read_only") is True
     and doc.get("camera_apk_modified") is False
     and doc.get("originals_modified") is False
     and doc.get("reference_created") is False
     and doc.get("human_review_required") is True
     and doc.get("automatic_person_assignments")==0
     and type(doc.get("detector_valid_face_count")) is int
     and 0<=doc["detector_valid_face_count"]<=4):
  raise RuntimeError("one_snapshot_result_contract_failed")
 current_camera()
 if adb("shell","pidof nl.kalenel.s9security")!=pid:
  raise RuntimeError("camera_pid_changed_after_one_snapshot")
 print("S9_YUNET_REAL_ONE_SNAPSHOT_VERIFIED "+json.dumps({
    "candidate_image_tested":1,"candidate_inventory_bounded":count,
    "detector_valid_face_count":doc["detector_valid_face_count"],
    "native_geometry_quality_accepted":doc.get("genuine_five_point_geometry_valid") is True,
    "identity_or_reference_created":False,"pixels_sent_to_hub":False,
    "originals_modified":False,"camera_apk_modified":False,
    "manual_reviews_modified":False},sort_keys=True),flush=True)
def main():
 parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 try:
  if LOCK.is_symlink():raise RuntimeError("untrusted_offline_worker_lock")
  with LOCK.open("a+") as guard:
   fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
   health=current_camera()
   name,count=select()
   pid=adb("shell","pidof nl.kalenel.s9security")
   if not re.fullmatch(r"[0-9 ]+",pid):raise RuntimeError("camera_pid_unknown")
   if not args.apply:
    print("S9_YUNET_REAL_ONE_SNAPSHOT_PREFLIGHT "+json.dumps({
      "one_candidate_available":True,"source_sha_present":True,
      "source_video_modified":False,"phone_temperature_c":health["temperature_c"],
      "person_identification_enabled":False}),flush=True)
    return
   with tempfile.TemporaryDirectory(prefix="s9-yunet-one-") as directory:
    execute(name,count,build(Path(directory)),pid)
 except (RuntimeError,BlockingIOError) as e:
  label="another_s9_worker_active" if isinstance(e,BlockingIOError) else str(e)
  benign=("capture_not_cool_idle","no_source_qualified_unpadded_face_snapshot",
          "hub_root_disk_reserve_low","another_s9_worker_active")
  if label=="android_app_process_terminated_without_face_evidence":
   # The phone shell terminated before any trustworthy face result. Verify the
   # camera survived it before treating this as a safe deferred audit.
   after=current_camera()
   if adb("shell","pidof nl.kalenel.s9security")!=pid:
    raise RuntimeError("camera_pid_changed_after_yunet_termination")
   print("S9_YUNET_REAL_ONE_SNAPSHOT_DEFERRED "+json.dumps({
    "reason":label,"detector_inference_verified":False,
    "native_camera_ready_after":True,
    "camera_dropped_output_frames_after":after["continuous_4k_dropped_output_frames"],
    "phone_temperature_after_c":after["temperature_c"],
    "automatic_person_assignments":0,
    "reference_created":False,"camera_apk_modified":False,
    "originals_modified":False,"manual_reviews_modified":False
   },sort_keys=True),flush=True)
   return
  if label in benign:
   print("S9_YUNET_REAL_ONE_SNAPSHOT_DEFERRED "+json.dumps({
    "reason":label,"executed":False,"camera_apk_modified":False,
    "originals_modified":False}),flush=True)
   return
  raise
if __name__=="__main__":main()
