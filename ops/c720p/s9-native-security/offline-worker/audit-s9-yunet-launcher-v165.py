#!/usr/bin/env python3
"""Read-only S9 Android YuNet launcher preflight: NO Java, model or image execution.

Inspect bounded OS/ABI, staged native dependency presence and error-code
counts only. Never print identities, filenames, commands, raw logcat,
model data or sensitive Android messages. Camera and backfill work outrank
this diagnostic.
"""
import fcntl
import json
from pathlib import Path
import re
import subprocess
import urllib.request

SERIAL="192.168.178.250:5555"
MODEL="SM-G965F"
WORKER="/data/local/tmp/s9_worker"
LIBS=WORKER+"/lib"
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill.lock")
CAMERA="http://127.0.0.1:18808/status"
MARK="S9_YUNET_ANDROID_LAUNCH_ENV_V165 "
LOG_TAGS=("AndroidRuntime:E","linker:E","DEBUG:E","ActivityManager:W")
LOG_INDICATORS={
 "native_linker":re.compile(r"linker|dlopen failed",re.I),
 "java_fatal":re.compile(r"FATAL EXCEPTION",re.I),
 "native_dependency":re.compile(r"UnsatisfiedLinkError|NoClassDefFoundError",re.I),
 "kernel_low_memory":re.compile(r"lowmemorykiller|lmkd|OutOfMemoryError",re.I),
 "permission_denial":re.compile(r"avc: denied|Permission denied",re.I),
}
SAFE_ABI=re.compile(r"[a-z0-9_,-]{1,120}\Z")
SAFE_PID=re.compile(r"[0-9]{1,7}(?: [0-9]{1,7}){0,2}\Z")

class Stop(Exception):
 pass

def require(ok,why):
 if not ok:raise Stop(why)

def proc(args,timeout=9,cap=5000):
 try:p=subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=False)
 except (OSError,subprocess.TimeoutExpired):
  raise Stop("read_only_phone_transport_unavailable") from None
 require(len(p.stdout)<=cap and len(p.stderr)<=cap,
         "read_only_phone_response_oversized")
 return p

def adb(*args,timeout=9,cap=5000):
 return proc(["adb","-s",SERIAL,*args],timeout,cap)

def shell_text(cmd):
 p=adb("shell",cmd)
 require(p.returncode==0 and not p.stderr.strip(),
         "read_only_phone_shell_unavailable")
 return p.stdout.strip()

def phone_test(path,flag="-f"):
 # Caller passes fixed, authored paths, never user-provided file names.
 require(path.startswith(("/system/bin/","/data/local/tmp/s9_worker/")),
         "untrusted_probe_path")
 p=adb("shell","test "+flag+" "+path)
 require(p.returncode in (0,1) and not p.stderr.strip(),
         "phone_file_metadata_unavailable")
 return p.returncode==0

def health():
 with urllib.request.urlopen(CAMERA,timeout=8) as response:
  require(response.status==200,"camera_status_not_ok")
  raw=response.read(65_537)
 require(len(raw)<=65_536,"camera_status_oversized")
 d=json.loads(raw)
 require(d.get("ok") is True and d.get("mode")=="watching"
  and d.get("native_4k_enabled") is True
  and d.get("continuous_4k_ready") is True
  and d.get("continuous_4k_dropped_output_frames")==0
  and not d.get("continuous_4k_error")
  and type(d.get("temperature_c")) in (int,float)
  and 0<d["temperature_c"]<=37.5
  and type(d.get("continuous_4k_buffered_ms")) is int
  and d["continuous_4k_buffered_ms"]>=6500
  and not any(d.get(x) is True for x in
       ("recording_active","recording_in_progress",
        "face_backfill_queued","appearance_backfill_queued",
        "historical_import_queued")),
  "s9_capture_busy_hot_or_unhealthy")
 return d

def log_summary():
 # Existing 160 bounded tagged rows: aggregate categories only, never raw log.
 args=["logcat","-d","-t","160","-v","brief","-s",*LOG_TAGS]
 try:p=adb("shell"," ".join(args),timeout=10,cap=40_000)
 except Stop:return {"status":"unavailable"}
 if p.returncode!=0:
  return {"status":"unavailable"}
 raw=p.stdout
 return {"status":"bounded_indicators",
         "not_attributable_to_yunet":True,
         "counts":{k:min(160,len(pattern.findall(raw)))
                   for k,pattern in LOG_INDICATORS.items()}}

def audit():
 require(LOCK.is_file() and not LOCK.is_symlink(),"shared_s9_worker_lock_untrusted")
 with LOCK.open("r") as lock:
  try:fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
  except BlockingIOError:raise Stop("other_s9_worker_active") from None
  before=health()
  state=adb("get-state")
  require(state.returncode==0 and state.stdout.strip()=="device",
          "s9_adb_not_ready")
  require(shell_text("getprop ro.product.model")==MODEL,"wrong_s9_device")
  pid_before=shell_text("pidof nl.kalenel.s9security")
  require(bool(SAFE_PID.fullmatch(pid_before)),"native_camera_pid_unavailable")
  abi=shell_text("getprop ro.product.cpu.abilist64")
  require(bool(SAFE_ABI.fullmatch(abi)),"android_64_bit_abi_missing")
  sec=shell_text("getenforce")
  require(sec in ("Enforcing","Permissive"),"android_security_mode_unavailable")
  metadata={
   "android_64bit_abi_reported":True,
   "android_64bit_abi_arm64_present":"arm64-v8a" in abi.split(","),
   "selinux_enforcing":sec=="Enforcing",
   "system_app_process64_executable":phone_test("/system/bin/app_process64","-x"),
   "onnxruntime_jni_library_present":phone_test(
       LIBS+"/libonnxruntime4j_jni.so"),
   "onnxruntime_native_library_present":phone_test(
       LIBS+"/libonnxruntime.so"),
   "staged_worker_directory_present":phone_test(WORKER+"/.","-d"),
  }
  logs=log_summary()
  after=health()
  pid_after=shell_text("pidof nl.kalenel.s9security")
  require(pid_after==pid_before,"native_camera_pid_changed")
  return {
    "status":"verified_readonly","device_is_s9":True,
    "model_or_image_read":False,"app_process_invoked":False,
    "recordings_modified":False,"human_reviews_modified":False,
    "camera_apk_modified":False,"filesystem_cleanup":False,
    "native_4k_ready_after":True,
    "native_capture_dropped_output_frames_after":after[
        "continuous_4k_dropped_output_frames"],
    "camera_temperature_before_c":before["temperature_c"],
    "camera_temperature_after_c":after["temperature_c"],
    "camera_pid_unchanged":True,
    "environment":metadata,"logs":logs,
  }

def main():
 try:result=audit()
 except Exception as error:
  # Only fixed source-authored codes. No raw ADB arguments/stderr/filenames.
  reason=str(error) if isinstance(error,Stop) else "probe_error_no_private_detail"
  allowed={"shared_s9_worker_lock_untrusted","other_s9_worker_active",
    "s9_capture_busy_hot_or_unhealthy","s9_adb_not_ready","wrong_s9_device",
    "native_camera_pid_unavailable","android_64_bit_abi_missing",
    "android_security_mode_unavailable","phone_file_metadata_unavailable",
    "read_only_phone_shell_unavailable","read_only_phone_transport_unavailable",
    "read_only_phone_response_oversized","camera_status_not_ok",
    "camera_status_oversized","untrusted_probe_path","native_camera_pid_changed"}
  result={"status":"deferred","reason":reason if reason in allowed
          else "probe_error_no_private_detail","model_or_image_read":False,
          "app_process_invoked":False,"camera_apk_modified":False,
          "recordings_modified":False,"human_reviews_modified":False}
 print(MARK+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
 if result["status"]!="verified_readonly":raise SystemExit(1)

if __name__=="__main__":main()
