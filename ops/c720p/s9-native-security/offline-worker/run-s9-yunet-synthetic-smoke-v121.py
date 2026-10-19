#!/usr/bin/env python3
"""One synthetic S9+ YuNet ONNX smoke, NEVER human/video inference.

The C720P only compiles and transports a separate DEX in a private worker
directory. All ONNX execution happens on the S9+, after independently proving
the pinned model exists and the continuous native 4K ring is idle/cool.
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
MODEL=Path("/storage/9C33-6BBD/S9OfflineModels/face_five_point_yunet_2023mar.onnx")
ROOT="/data/local/tmp/s9_worker"
PHONE="192.168.178.250:5555"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
AAR_URI=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
         "onnxruntime-android/1.22.0/onnxruntime-android-1.22.0.aar")
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill.lock")
JAVA=HERE/"S9YuNetOnnxSyntheticSmoke.java"
CLASS="nl.kalenel.s9offline.S9YuNetOnnxSyntheticSmoke"
OK="S9_YUNET_GENUINE_ON_PHONE_ONNX_SYNTHETIC_SHAPE_PASS"

def run(argv,timeout=70):
 proc=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
 if proc.returncode:
  raise RuntimeError("isolated_phone_worker_command_failed")
 return proc.stdout.strip()

def adb(*args,timeout=22):
 return run(["adb","-s",PHONE,*args],timeout=timeout)

def phone_sha(path):
 # A transport failure must not be interpreted as a missing input.
 proc=subprocess.run(["adb","-s",PHONE,"shell","test -s "+path],
                     capture_output=True,text=True,timeout=15)
 if proc.returncode==1 and not proc.stderr.strip():return None
 if proc.returncode:raise RuntimeError("unavailable_phone_model_or_dex")
 out=adb("shell","sha256sum "+path)
 m=re.fullmatch(r"([a-f0-9]{64})\s+\S+",out.strip())
 if not m:raise RuntimeError("invalid_phone_sha")
 return m.group(1)

def phone_path_exists_safely(path):
 # Reject both actual files and pre-existing zero-byte partial transfers.
 # Never follow a symlink into an unrelated phone/media directory.
 for flag in ("-L","-e"):
  proc=subprocess.run(["adb","-s",PHONE,"shell","test "+flag+" "+path],
                      capture_output=True,text=True,timeout=15)
  if proc.returncode not in (0,1) or proc.stderr.strip():
   raise RuntimeError("phone_temp_path_status_indeterminate")
  if flag=="-L" and proc.returncode==0:
   raise RuntimeError("unsafe_phone_worker_symlink")
  if flag=="-e" and proc.returncode==0:return True
 return False

def sha(raw):return hashlib.sha256(raw).hexdigest()

def health():
 req=urllib.request.Request("http://127.0.0.1:18808/status",
                            headers={"Cache-Control":"no-store"})
 with urllib.request.urlopen(req,timeout=12) as response:
  if response.status!=200:raise RuntimeError("camera_status_unavailable")
  data=response.read(65537)
 if len(data)>65536:raise RuntimeError("camera_status_oversize")
 status=json.loads(data)
 if (status.get("ok") is not True
     or status.get("mode")!="watching"
     or status.get("continuous_4k_ready") is not True
     or status.get("native_4k_enabled") is not True
     or status.get("continuous_4k_production_persisted") is not True
     or status.get("continuous_4k_dropped_output_frames")!=0
     or status.get("continuous_4k_error")
     or type(status.get("continuous_4k_buffered_ms")) is not int
     or status["continuous_4k_buffered_ms"]<6500
     or type(status.get("temperature_c")) not in (int,float)
     or not 0<status["temperature_c"]<=38.7
     or type(status.get("sd_free_bytes")) is not int
     or status["sd_free_bytes"]<20*1024**3
     or any(status.get(key) is True for key in
           ("recording_active","recording_in_progress","garden_person_gate_busy",
            "face_backfill_queued","movement_4k_backfill_queued",
            "appearance_backfill_queued","historical_import_queued"))):
  raise RuntimeError("camera_not_safe_for_synthetic_smoke")
 return status

def prerequisites():
 if LOCK.is_symlink() or not LOCK.parent.is_dir():
  raise RuntimeError("untrusted_worker_lock")
 if JAVA.is_symlink() or not JAVA.is_file():
  raise RuntimeError("missing_synthetic_smoke_source")
 if shutil.disk_usage("/").free<850*1024**2:
  raise RuntimeError("hub_disk_reserve_low")
 if phone_sha(str(MODEL))!=MODEL_SHA:
  raise RuntimeError("pinned_landmark_model_not_staged")
 for name in ("libonnxruntime.so","libonnxruntime4j_jni.so"):
  if phone_sha(ROOT+"/lib/"+name) is None:
   raise RuntimeError("isolated_onnxruntime_library_missing")

def build(tmp):
 aar=tmp/"onnxruntime.aar"
 req=urllib.request.Request(AAR_URI,headers={"User-Agent":"S9-YuNet-Synthetic/1"})
 with urllib.request.urlopen(req,timeout=35) as r:
  if r.status!=200:raise RuntimeError("unavailable_pinned_ort_artifact")
  data=r.read(30000001)
 if len(data)>30000000 or sha(data)!=AAR_SHA:
  raise RuntimeError("official_ort_aar_sha_mismatch")
 aar.write_bytes(data)
 with zipfile.ZipFile(aar) as z:
  if "classes.jar" not in z.namelist():raise RuntimeError("ort_java_classes_missing")
  jar=tmp/"ort.jar";jar.write_bytes(z.read("classes.jar"))
 classes=tmp/"classes";classes.mkdir()
 run(["javac","-source","8","-target","8","-cp",str(jar),
      "-d",str(classes),str(JAVA)],timeout=65)
 dex=tmp/"dex";dex.mkdir()
 blobs=sorted(str(p) for p in classes.rglob("*.class"))
 if not blobs:raise RuntimeError("empty_yunet_smoke_classes")
 run(["d8","--min-api","29","--output",str(dex),str(jar),*blobs],timeout=95)
 raw=(dex/"classes.dex").read_bytes()
 if not 1000<len(raw)<1500000:raise RuntimeError("invalid_yunet_smoke_dex")
 result=tmp/"smoke.jar"
 with zipfile.ZipFile(result,"w",compression=zipfile.ZIP_DEFLATED) as zipout:
  zi=zipfile.ZipInfo("classes.dex",date_time=(2020,1,1,0,0,0))
  zi.compress_type=zipfile.ZIP_DEFLATED
  zi.external_attr=0o600<<16
  zipout.writestr(zi,raw)
 return result

def test_phone(artifact):
 digest=sha(artifact.read_bytes())
 # A versioned, isolated jar, never s9-worker.jar or the camera APK.
 remote=ROOT+"/s9-yunet-smoke-"+digest[:16]+".jar"
 if phone_path_exists_safely(remote) and phone_sha(remote) is None:
  raise RuntimeError("unknown_non_regular_existing_phone_dex")
 before=phone_sha(remote)
 if before is not None and before!=digest:
  raise RuntimeError("existing_phone_dex_digest_mismatch")
 if before is None:
  part=remote+".pending"
  if phone_path_exists_safely(part):
   raise RuntimeError("unknown_pending_dex_do_not_overwrite")
  run(["adb","-s",PHONE,"push",str(artifact),part],timeout=40)
  if phone_sha(part)!=digest:raise RuntimeError("unverified_phone_dex_upload")
  adb("shell","mv "+part+" "+remote+" && chmod 600 "+remote)
  if phone_sha(remote)!=digest:raise RuntimeError("unverified_phone_dex_finalize")
 # Model execution is done only on-phone using isolated ORT JNI runtime.
 health()
 cmd=("export LD_LIBRARY_PATH="+ROOT+"/lib; "
      "export CLASSPATH="+remote+"; "
      "app_process -Djava.library.path="+ROOT+"/lib /system/bin "+
      CLASS+" --synthetic-smoke")
 result=adb("shell",cmd,timeout=85)
 if OK not in result:
  raise RuntimeError("yunet_phone_shape_smoke_not_verified")
 return digest

def main():
 arg=argparse.ArgumentParser()
 arg.add_argument("--apply",action="store_true")
 a=arg.parse_args()
 try:
  with LOCK.open("a+") as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   pre=health()
   prerequisites()
   pid=adb("shell","pidof nl.kalenel.s9security")
   if not re.fullmatch(r"[0-9 ]+",pid):
    raise RuntimeError("camera_process_unknown")
   if not a.apply:
    print("S9_YUNET_REAL_PHONE_SYNTHETIC_PREFLIGHT "+
          json.dumps({"ready":True,"model_sha_verified":True,
                      "human_faces_read":False,"camera_apk_modified":False}),flush=True)
    return
   with tempfile.TemporaryDirectory(prefix="s9-yunet-smoke-") as temp:
    digest=test_phone(build(Path(temp)))
   post=health()
   if adb("shell","pidof nl.kalenel.s9security")!=pid:
    raise RuntimeError("camera_process_changed_during_smoke")
   print("S9_YUNET_REAL_PHONE_SYNTHETIC_VERIFIED "+
         json.dumps({"model_sha_verified":True,"jar_sha256":digest,
                     "temperature_before_c":pre["temperature_c"],
                     "temperature_after_c":post["temperature_c"],
                     "human_faces_read":False,"new_face_references":0,
                     "people_assigned":0,"originals_modified":False,
                     "manual_reviews_modified":False,"camera_apk_modified":False}),flush=True)
 except (BlockingIOError,RuntimeError) as e:
  reason=str(e)
  benign={"camera_not_safe_for_synthetic_smoke","pinned_landmark_model_not_staged",
          "hub_disk_reserve_low","isolated_onnxruntime_library_missing"}
  if isinstance(e,BlockingIOError):reason="another_phone_worker_active"
  if reason in benign or reason=="another_phone_worker_active":
   print("S9_YUNET_REAL_PHONE_SYNTHETIC_DEFERRED "+
         json.dumps({"reason":reason,"verified":False,"faces_read":False,
                     "camera_apk_modified":False}),flush=True)
   return
  raise

if __name__=="__main__":main()
