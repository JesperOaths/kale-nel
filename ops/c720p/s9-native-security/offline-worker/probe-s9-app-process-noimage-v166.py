#!/usr/bin/env python3
"""One bounded S9+ Android ART startup test; NO YuNet model or images.

Build tiny source-only DEX on C720P, stage it under the isolated worker area
with exact SHA-256, launch once in the *ordinary adb shell* environment, then
prove S9 Camera2 native 4K and its PID survived. Never expose the phone output,
file paths, arguments, identities or command stderr. No Camera2 APK or review
change, no archive touches, and never retry a terminated launcher.
"""
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

HERE=Path(__file__).resolve().parent
JAVA=HERE/"S9AppProcessNoImageBaselineV166.java"
AND_JAR=Path("/usr/lib/android-sdk/platforms/android-36/android.jar")
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill.lock")
PHONE="192.168.178.250:5555"
MODEL="SM-G965F"
WORKER="/data/local/tmp/s9_worker"
CAMERA="http://127.0.0.1:18808/status"
MARK="S9_APP_PROCESS_BASELINE_V166 "
EXPECTED="S9_APP_PROCESS_NO_IMAGE_BASELINE_V166_OK"
CLASS="nl.kalenel.s9offline.S9AppProcessNoImageBaselineV166"
SHA=re.compile(r"[a-f0-9]{64}\Z")
PID=re.compile(r"[0-9]{1,7}(?: [0-9]{1,7}){0,2}\Z")

class Stop(Exception):pass
def require(value,why):
 if not value:raise Stop(why)
def digest(data):return hashlib.sha256(data).hexdigest()

def call(cmd,seconds=24):
 try:
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=seconds,check=False)
 except (OSError,subprocess.TimeoutExpired):
  raise Stop("bounded_build_or_phone_operation_failed") from None
 require(len(p.stdout)<=15000 and len(p.stderr)<=15000,
         "bounded_command_response_exceeded")
 return p

def adb(*args,seconds=24):
 return call(["adb","-s",PHONE,*args],seconds)

def must_adb(*args,seconds=24):
 p=adb(*args,seconds=seconds)
 require(p.returncode==0 and not p.stderr.strip(),
         "phone_transport_or_shell_failure")
 return p.stdout.strip()

def current_camera():
 with urllib.request.urlopen(CAMERA,timeout=9) as reply:
  require(reply.status==200,"camera_http_bad_status")
  body=reply.read(65537)
 require(len(body)<=65536,"camera_status_too_large")
 d=json.loads(body)
 # Fixed, non-identifying reason codes: never expose clip, person or
 # path information. This ONLY improves diagnostics, never relaxes admission.
 require(d.get("ok") is True and d.get("mode")=="watching"
   and d.get("native_4k_enabled") is True
   and d.get("continuous_4k_ready") is True
   and d.get("continuous_4k_dropped_output_frames")==0
   and not d.get("continuous_4k_error"),"native_4k_pipeline_unhealthy")
 require(type(d.get("temperature_c")) in (float,int)
   and 0<d["temperature_c"]<=36.5,"native_4k_temperature_guard")
 require(type(d.get("continuous_4k_buffered_ms")) is int
   and d["continuous_4k_buffered_ms"]>=6500,
   "native_4k_buffer_not_ready")
 require(not any(d.get(key) is True for key in
   ("recording_active","recording_in_progress")),
   "native_4k_recording_in_progress")
 require(not any(d.get(key) is True for key in
   ("face_backfill_queued","appearance_backfill_queued",
    "historical_import_queued")),
   "s9_background_work_queued")
 return d

def build(folder):
 require(JAVA.is_file() and not JAVA.is_symlink()
         and 100<JAVA.stat().st_size<5000,"tiny_java_source_untrusted")
 source=JAVA.read_text()
 for forbidden in ("ai.onnxruntime","Bitmap","Camera2","new File(",
                   "FileOutputStream","http://","https://"):
  require(forbidden not in source,"non_minimal_android_baseline")
 require(AND_JAR.is_file() and not AND_JAR.is_symlink(),
         "android_sdk_unavailable")
 require(shutil.disk_usage("/").free>=850*1024*1024,
         "hub_disk_reserve_for_build")
 compiled=folder/"compiled";compiled.mkdir()
 javac=call(["javac","-source","8","-target","8","-d",str(compiled),str(JAVA)],25)
 require(javac.returncode==0,"minimal_java_compile_failure")
 objects=list(compiled.rglob("*.class"))
 require(len(objects)==1 and objects[0].stat().st_size<20000,
         "unexpected_minimal_java_classes")
 dex=folder/"dex";dex.mkdir()
 run=call(["d8","--min-api","28","--lib",str(AND_JAR),
           "--output",str(dex),str(objects[0])],45)
 require(run.returncode==0,"minimal_dex_compile_failure")
 compiled_dex=dex/"classes.dex"
 require(compiled_dex.is_file() and 100<compiled_dex.stat().st_size<100000,
         "minimal_dex_untrusted")
 jar=folder/"app-process-baseline-v166.jar"
 with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as z:
  z.write(compiled_dex,"classes.dex")
 require(100<jar.stat().st_size<100000,"minimal_jar_untrusted")
 return jar

def exists(remote):
 p=adb("shell","test -e "+remote,seconds=8)
 require(p.returncode in (0,1) and not p.stderr.strip(),
         "phone_presence_indeterminate")
 return p.returncode==0

def phone_digest(remote):
 raw=must_adb("shell","sha256sum "+remote,seconds=12).split()
 require(len(raw)==2 and SHA.fullmatch(raw[0]) and raw[1]==remote,
         "phone_digest_untrusted")
 return raw[0]

def stage(jar):
 sha=digest(jar.read_bytes())
 target=WORKER+"/s9-noimage-baseline-v166-"+sha[:16]+".jar"
 if exists(target):
  require(phone_digest(target)==sha,"known_minimal_worker_changed")
  return target
 partial=target+".pending"
 require(not exists(partial),"unknown_pending_minimal_worker")
 must_adb("push",str(jar),partial,seconds=35)
 require(phone_digest(partial)==sha,"minimal_worker_copy_failed")
 must_adb("shell","mv "+partial+" "+target+" && chmod 600 "+target)
 require(phone_digest(target)==sha,"minimal_worker_promotion_failed")
 return target

def launch(target):
 # One bounded isolated shell startup. No ONNX, no model or private image.
 command="export CLASSPATH="+target+"; app_process /system/bin "+CLASS+" --baseline-no-image"
 try:p=adb("shell",command,seconds=12)
 except Stop as e:
  return {"success":False,"reason":"bounded_transport_failure"}
 if p.returncode==0 and p.stdout.strip()==EXPECTED:
  return {"success":True,"reason":"java_baseline_pass"}
 if p.returncode in (137,-9) or re.search(r"\bkilled\b",p.stderr+" "+p.stdout,re.I):
  return {"success":False,"reason":"android_baseline_terminated"}
 return {"success":False,"reason":"java_baseline_not_verified"}

def run():
 require(LOCK.is_file() and not LOCK.is_symlink(),"shared_s9_lock_unavailable")
 with LOCK.open("r") as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Stop("other_phone_worker_running") from None
  before=current_camera()
  require(must_adb("get-state")=="device","phone_not_ready")
  require(must_adb("shell","getprop ro.product.model")==MODEL,"wrong_android_device")
  oldpid=must_adb("shell","pidof nl.kalenel.s9security")
  require(bool(PID.fullmatch(oldpid)),"camera_process_unverified")
  with tempfile.TemporaryDirectory(prefix="s9-noimage-v166-") as tmp:
   jar=build(Path(tmp))
   current_camera()
   remote=stage(jar)
   current_camera()
   result=launch(remote)
  after=current_camera()
  require(must_adb("shell","pidof nl.kalenel.s9security")==oldpid,
          "native_camera_pid_changed_after_baseline")
  return {"status":"physical_baseline_checked",
          "android_java_baseline_started":result["success"],
          "reason":result["reason"],
          "launch_attempts":1,
          "yu_net_inference_executed":False,
          "model_or_image_opened":False,
          "camera_apk_modified":False,"recordings_modified":False,
          "human_reviews_modified":False,"originals_deleted":False,
          "minimal_temporary_worker_only":True,
          "native_camera_ready_after":True,
          "capture_dropped_output_frames_after":after[
            "continuous_4k_dropped_output_frames"],
          "camera_temperature_before_c":before["temperature_c"],
          "camera_temperature_after_c":after["temperature_c"],
          "camera_pid_unchanged":True}

def main():
 try:result=run()
 except Exception as error:
  why=str(error) if isinstance(error,Stop) else "unexpected_failure_no_private_detail"
  allowed={"shared_s9_lock_unavailable","other_phone_worker_running",
     "native_4k_capture_not_idle_and_cool","camera_http_bad_status",
     "camera_status_too_large","tiny_java_source_untrusted",
     "non_minimal_android_baseline","android_sdk_unavailable",
     "hub_disk_reserve_for_build","minimal_java_compile_failure",
     "unexpected_minimal_java_classes","minimal_dex_compile_failure",
     "minimal_dex_untrusted","minimal_jar_untrusted",
     "phone_presence_indeterminate","phone_digest_untrusted",
     "known_minimal_worker_changed","unknown_pending_minimal_worker",
     "minimal_worker_copy_failed","minimal_worker_promotion_failed",
     "bounded_command_response_exceeded","bounded_build_or_phone_operation_failed",
     "phone_transport_or_shell_failure","phone_not_ready","wrong_android_device",
     "camera_process_unverified","native_camera_pid_changed_after_baseline",
     "native_4k_pipeline_unhealthy","native_4k_temperature_guard",
     "native_4k_buffer_not_ready","native_4k_recording_in_progress",
     "s9_background_work_queued"}
  result={"status":"deferred","reason":why if why in allowed
          else "unexpected_failure_no_private_detail",
          "yu_net_inference_executed":False,"model_or_image_opened":False,
          "camera_apk_modified":False,"recordings_modified":False,
          "human_reviews_modified":False}
 print(MARK+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
 if result["status"]!="physical_baseline_checked":raise SystemExit(1)
if __name__=="__main__":main()
