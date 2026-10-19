#!/usr/bin/env python3
"""Bounded one-shot REAL S9 microSD test with synthetic metadata and no media access.

Never executes an actual Save/Delete route, never handles any recorded clip,
and never provisions a production key. Validates real microSD FileLock,
FileDescriptor.sync, journal replay and process restart semantics only.
"""
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

HERE=Path(__file__).resolve().parent
GUARD=HERE/"probe-s9-app-process-noimage-v166.py"
JAVA=(HERE/"S9MigratedMetadataLedgerV193.java",
      HERE/"S9MigratedLedgerMicroSdSmokeV194.java")
MARK="S9_MICROSD_LEDGER_PHYSICAL_V194 "
CLASS="nl.kalenel.s9offline.S9MigratedLedgerMicroSdSmokeV194"
RESULT_MARK="S9_MICROSD_SYNTHETIC_LEDGER_V194 "
ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files"
TEST_ROOT=ROOT+"/C720PMigratedLedgerSyntheticV194"
CAP=280_000
SAFE_STAGE={"preflight","synthetic_directory","micro_sd_commit","micro_sd_readback"}

def guards():
 if GUARD.is_symlink() or not GUARD.is_file():
  raise RuntimeError("camera_guard_source_missing")
 spec=importlib.util.spec_from_file_location("s9_v166_synthetic_ledger_guard",str(GUARD))
 guard=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(guard)
 return guard

def build(guard,tmp):
 guard.require(shutil.disk_usage("/").free>=850*1024*1024,
               "hub_disk_reserve_for_synthetic_build")
 guard.require(guard.AND_JAR.is_file() and not guard.AND_JAR.is_symlink(),
               "android_sdk_unavailable")
 for file in JAVA:
  guard.require(file.is_file() and not file.is_symlink()
      and 200<file.stat().st_size<30000,"minimal_ledger_source_untrusted")
  source=file.read_text()
  for forbidden in ("onnxruntime", "CameraManager", "MediaCodec", "ClipClassifier",
       "Camera2Service", "Files.delete(", "adb push", "System.loadLibrary"):
   guard.require(forbidden not in source,"ledger_source_has_unsafe_capability")
 compiled=tmp/"classes";compiled.mkdir()
 command=["javac","-source","8","-target","8","-d",str(compiled)]
 command.extend(str(p) for p in JAVA)
 javac=guard.call(command,seconds=38)
 guard.require(javac.returncode==0,"ledger_java_compile_failed")
 classes=sorted(compiled.rglob("*.class"))
 guard.require(2<=len(classes)<=12
   and sum(c.stat().st_size for c in classes)<140_000,
   "ledger_java_class_count_invalid")
 dex=tmp/"dex";dex.mkdir()
 cmd=["d8","--min-api","28","--lib",str(guard.AND_JAR),
      "--output",str(dex)]+[str(p) for p in classes]
 compile=guard.call(cmd,seconds=65)
 guard.require(compile.returncode==0,"ledger_dex_compile_failed")
 obj=dex/"classes.dex"
 guard.require(obj.is_file() and 1000<obj.stat().st_size<CAP,
               "ledger_dex_size_invalid")
 out=tmp/"s9-standalone-microsd-ledger-v194.jar"
 with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
  z.write(obj,"classes.dex")
 guard.require(1000<out.stat().st_size<CAP,"ledger_jar_size_invalid")
 return out

def stage(guard,jar):
 digest=hashlib.sha256(jar.read_bytes()).hexdigest()
 remote=guard.WORKER+"/s9-microsd-ledger-synthetic-v194-"+digest[:16]+".jar"
 if guard.exists(remote):
  guard.require(guard.phone_digest(remote)==digest,
                "staged_synthetic_worker_drift")
  return remote
 pending=remote+".pending"
 guard.require(not guard.exists(pending),"prior_pending_stage_untrusted")
 guard.must_adb("push",str(jar),pending,seconds=35)
 guard.require(guard.phone_digest(pending)==digest,"worker_staged_sha_mismatch")
 guard.must_adb("shell","mv "+pending+" "+remote+" && chmod 600 "+remote)
 guard.require(guard.phone_digest(remote)==digest,"worker_final_sha_mismatch")
 return remote

def launch(guard,remote):
 cmd="export CLASSPATH="+remote+"; app_process /system/bin "+CLASS+" --synthetic-microsd-once"
 proc=guard.adb("shell",cmd,seconds=25)
 if proc.returncode!=0:raise guard.Stop("synthetic_phone_ledger_execution_failed")
 text=proc.stdout.strip()
 if not text.startswith(RESULT_MARK) or "\n" in text or len(text)>1500:
  raise guard.Stop("synthetic_phone_result_invalid")
 try:result=json.loads(text[len(RESULT_MARK):])
 except ValueError:
  raise guard.Stop("synthetic_phone_result_invalid") from None
 if (result.get("status")!="micro_sd_two_decisions_reloaded"
     or result.get("metadata_actions")!=2
     or result.get("nonce_replay_refused") is not True
     or result.get("superseded_save_refused") is not True
     or result.get("delete_is_only_tombstone") is not True
     or result.get("journal_readback_verified") is not True
     or result.get("only_synthetic_directory_written") is not True
     or result.get("synthetic_key_persisted") is not False
     or result.get("originals_removed")!=0
     or result.get("real_clips_opened")!=0
     or result.get("real_save_delete_enabled") is not False
     or result.get("actual_person_reviews_modified") is not False
     or result.get("camera_apk_modified") is not False):
  raise guard.Stop("synthetic_phone_result_untrusted")
 return result

def run(guard):
 guard.require(guard.LOCK.is_file() and not guard.LOCK.is_symlink(),
               "existing_s9_worker_lock_unavailable")
 with guard.LOCK.open("r") as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:
   raise guard.Stop("s9_worker_busy") from None
  before=guard.current_camera()
  guard.require(guard.must_adb("get-state")=="device","phone_not_ready")
  guard.require(guard.must_adb("shell","getprop ro.product.model")==guard.MODEL,
                "wrong_s9_phone")
  pid=guard.must_adb("shell","pidof nl.kalenel.s9security")
  guard.require(bool(guard.PID.fullmatch(pid)),"native_camera_pid_untrusted")
  guard.require(guard.exists(ROOT),"phone_micro_sd_root_unavailable")
  guard.require(not guard.exists(TEST_ROOT),"existing_test_state_not_overwritten")
  with tempfile.TemporaryDirectory(prefix="s9-ledger-physical-v194-") as tmp:
   jar=build(guard,Path(tmp))
   guard.current_camera()
   remote=stage(guard,jar)
   guard.current_camera()
   outcome=launch(guard,remote)
  after=guard.current_camera()
  guard.require(guard.must_adb("shell","pidof nl.kalenel.s9security")==pid,
                "native_camera_pid_changed")
  return {"status":"verified_synthetic_micro_sd",
    "synthetic_commit_count":outcome["metadata_actions"],
    "ledger_journal_reloaded":True,
    "nonce_replay_refused":True,
    "test_ran_once":True,
    "production_secret_provisioned":False,
    "real_save_delete_enabled":False,
    "real_media_read_or_deleted":False,
    "human_reviews_modified":False,
    "camera_apk_modified":False,
    "native_camera_4k_ready_after":True,
    "capture_dropped_frames_after":after["continuous_4k_dropped_output_frames"],
    "camera_pid_unchanged":True,
    "camera_temperature_before_c":before["temperature_c"],
    "camera_temperature_after_c":after["temperature_c"]}

def main():
 try:report=run(guards())
 except Exception as error:
  code=str(error)
  allowed={"camera_guard_source_missing","hub_disk_reserve_for_synthetic_build",
    "android_sdk_unavailable","minimal_ledger_source_untrusted",
    "ledger_source_has_unsafe_capability","ledger_java_compile_failed",
    "ledger_java_class_count_invalid","ledger_dex_compile_failed",
    "ledger_dex_size_invalid","ledger_jar_size_invalid",
    "staged_synthetic_worker_drift","prior_pending_stage_untrusted",
    "worker_staged_sha_mismatch","worker_final_sha_mismatch",
    "synthetic_phone_ledger_execution_failed","synthetic_phone_result_invalid",
    "synthetic_phone_result_untrusted","existing_s9_worker_lock_unavailable",
    "s9_worker_busy","phone_not_ready","wrong_s9_phone",
    "native_camera_pid_untrusted","phone_micro_sd_root_unavailable",
    "existing_test_state_not_overwritten","native_camera_pid_changed",
    "native_4k_pipeline_unhealthy","native_4k_temperature_guard",
    "native_4k_buffer_not_ready","native_4k_recording_in_progress",
    "s9_background_work_queued","hub_disk_reserve_for_build"}
  report={"status":"deferred_or_failed",
    "reason":code if code in allowed else "operation_failed_no_private_details",
    "real_save_delete_enabled":False,"production_secret_provisioned":False,
    "real_media_read_or_deleted":False,"human_reviews_modified":False,
    "camera_apk_modified":False}
 print(MARK+json.dumps(report,sort_keys=True,separators=(",",":")),flush=True)
 if report["status"]!="verified_synthetic_micro_sd":
  raise SystemExit(1)

if __name__=="__main__":main()
