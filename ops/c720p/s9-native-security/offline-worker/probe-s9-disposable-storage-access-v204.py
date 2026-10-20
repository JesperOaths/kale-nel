#!/usr/bin/env python3
"""One-shot guarded Android10 cross-app media-access feasibility test.

Install a unique DISPOSABLE test-only receiver package with READ permission
and no camera/write/internet permissions; use an exported broadcast to check
directory enumeration + zero-byte FileInputStream open; always uninstall it.
The original S9 native Camera2 package/APK/recordings stay untouched.
"""
import fcntl
import importlib.util
import json
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent
GUARD=ROOT/"probe-s9-app-process-noimage-v166.py"
MANIFEST=ROOT/"s9-storage-probe-v204/AndroidManifest.xml"
SOURCE=ROOT/"s9-storage-probe-v204/StorageProbe.java"
PACKAGE="nl.kalenel.s9storageprobev204"
RECEIVER=PACKAGE+"/.StorageProbe"
ACTION=PACKAGE+".CHECK"
TAG="S9_STORAGE_PROBE_V204"
MARK="S9_STORAGE_PROBE_PHYSICAL_V204 "
APKSIZE=1_000_000
RESULT=re.compile(
 r"RESULT directory_exists=(true|false) enumeration_allowed=(true|false)"
 r" found_mp4=(true|false) opened_readonly=(true|false)"
 r" bytes_read=0 media_modified=false")
class Halt(Exception):pass

def gate():
 if not GUARD.is_file() or GUARD.is_symlink():
  raise Halt("camera_guard_unavailable")
 spec=importlib.util.spec_from_file_location("s9_v204_camera_guard",str(GUARD))
 g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
 return g

def require(condition,reason):
 if not condition:raise Halt(reason)

def run_command(args,seconds=35):
 try:p=subprocess.run(args,capture_output=True,text=True,timeout=seconds)
 except (subprocess.TimeoutExpired,OSError):
  raise Halt("bounded_build_failed") from None
 require(p.returncode==0,"bounded_build_failed")
 return p

def build(g,tmp):
 require(shutil.disk_usage("/").free>=850*1024*1024,
         "hub_disk_reserve_for_build")
 for p in [MANIFEST,SOURCE]:
  require(p.is_file() and not p.is_symlink()
          and 200<p.stat().st_size<7500,"probe_source_untrusted")
 source=SOURCE.read_text();xml=MANIFEST.read_text()
 for token in ("CameraManager","MediaCodec","new Socket(","stream.read();",
               "FileOutputStream","HttpURLConnection","new URL("):
  require(token not in source,"probe_contains_unapproved_capability")
 for token in ('android.permission.CAMERA','android.permission.INTERNET',
               'android.permission.WRITE_EXTERNAL_STORAGE',
               'android.permission.MANAGE_EXTERNAL_STORAGE'):
  require(token not in xml,"probe_manifest_unapproved_permission")
 require(PACKAGE in xml and "READ_EXTERNAL_STORAGE" in xml,
         "probe_manifest_drift")
 require(g.AND_JAR.is_file(),"android_platform_jar_unavailable")
 classes=tmp/"classes";dex=tmp/"dex"
 classes.mkdir();dex.mkdir()
 run_command(["javac","-source","8","-target","8","-cp",str(g.AND_JAR),
              "-d",str(classes),str(SOURCE)],30)
 objects=list(classes.rglob("*.class"))
 require(len(objects)==1 and 100<objects[0].stat().st_size<24000,
         "unexpected_probe_classes")
 run_command(["d8","--min-api","28","--lib",str(g.AND_JAR),
              "--output",str(dex),str(objects[0])],45)
 code=dex/"classes.dex"
 require(code.is_file() and 300<code.stat().st_size<120000,
         "unexpected_probe_dex")
 unsigned=tmp/"unsigned.apk"
 run_command(["aapt","package","-f","-M",str(MANIFEST),"-I",
              str(g.AND_JAR),"-F",str(unsigned)],30)
 # aapt adds files under the archive's relative name.
 with tempfile.TemporaryDirectory(prefix="s9-probe-aapt-") as nested:
  staging=Path(nested)/"classes.dex"
  shutil.copyfile(code,staging)
   # AAPT uses its current working directory for the new archive member.
  p=subprocess.run(["aapt","add",str(unsigned),"classes.dex"],cwd=nested,
       capture_output=True,text=True,timeout=10)
  require(p.returncode==0,"apk_dex_packaging_failed")
 passwd=secrets.token_urlsafe(24)
 key=tmp/"ephemeral-only.jks"
 run_command(["keytool","-genkeypair","-noprompt","-alias","disposable204",
    "-keyalg","RSA","-keysize","2048","-validity","1",
    "-dname","CN=Temporary S9 Storage Probe",
    "-keystore",str(key),"-storepass",passwd,"-keypass",passwd],35)
 apk=tmp/"disposable-s9-storage-probe.apk"
 run_command(["apksigner","sign","--ks",str(key),
    "--ks-key-alias","disposable204",
    "--ks-pass","pass:"+passwd,"--key-pass","pass:"+passwd,
    "--out",str(apk),str(unsigned)],30)
 run_command(["apksigner","verify",str(apk)],20)
 require(apk.is_file() and 1000<apk.stat().st_size<APKSIZE,
         "signed_probe_size_invalid")
 return apk

def packages(g):
 p=g.adb("shell","pm list packages "+PACKAGE,seconds=12)
 require(p.returncode==0,"package_inventory_unavailable")
 return PACKAGE in p.stdout

def invoke(g,apk):
 installed=False
 initially_absent=False
 try:
  require(not packages(g),"probe_package_preexisting_not_touched")
  initially_absent=True
  g.current_camera()
  p=g.adb("install","-g",str(apk),seconds=42)
  require(p.returncode==0 and "Success" in p.stdout,
          "disposable_install_failed")
  installed=True
  require(packages(g),"disposable_install_unconfirmed")
  g.current_camera()
  p=g.adb("shell","am broadcast -a "+ACTION+" -n "+RECEIVER,seconds=15)
  require(p.returncode==0,"disposable_broadcast_failed")
  logs=g.adb("shell","logcat -d -v brief -s "+TAG+":I '*:S'",seconds=15)
  require(logs.returncode==0,"probe_logcat_unavailable")
  lines=[i for i in logs.stdout.splitlines() if TAG in i and "RESULT " in i]
  require(len(lines)>=1 and len(lines)<=10,"probe_aggregate_result_missing")
  m=RESULT.search(lines[-1])
  require(m is not None,"probe_aggregate_result_invalid")
  return dict(zip(("directory_exists","enumeration_allowed",
      "found_mp4","opened_readonly"),[v=="true" for v in m.groups()]))
 finally:
  # Never uninstall an app observed to exist before this invocation.
  if initially_absent and (installed or packages(g)):
   p=g.adb("uninstall",PACKAGE,seconds=30)
   require(p.returncode==0 and "Success" in p.stdout,
           "disposable_probe_uninstall_failed")
   require(not packages(g),"disposable_probe_still_present")

def conduct(g):
 require(g.LOCK.is_file() and not g.LOCK.is_symlink(),
         "shared_camera_lock_unavailable")
 with g.LOCK.open("r") as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Halt("camera_worker_busy") from None
  before=g.current_camera()
  require(before["temperature_c"]<=35.0,"temperature_too_high_for_probe")
  require(g.must_adb("shell","getprop ro.product.model")==g.MODEL,
          "incorrect_phone")
  require(g.must_adb("shell","getprop ro.build.version.sdk")=="29",
          "android_version_drift")
  pid=g.must_adb("shell","pidof nl.kalenel.s9security")
  require(bool(g.PID.fullmatch(pid)),"camera_pid_untrusted")
  require(not packages(g),"disposable_package_already_installed")
  with tempfile.TemporaryDirectory(prefix="s9-sd-permission-v204-") as temp:
   apk=build(g,Path(temp))
   g.current_camera()
   result=invoke(g,apk)
  after=g.current_camera()
  require(g.must_adb("shell","pidof nl.kalenel.s9security")==pid,
          "camera_pid_changed")
  return {"status":"isolated_readonly_storage_probe_verified",
          "android_api":29,"native_camera_pid_unchanged":True,
          "camera_temperature_before_c":before["temperature_c"],
          "camera_temperature_after_c":after["temperature_c"],
          "disposable_app_uninstalled":True,
          "camera_apk_modified":False,"media_bytes_read":0,
          "originals_modified":False,"person_reviews_modified":False,
          "write_permission_granted":False,**result}

def main():
 try:output=conduct(gate())
 except Exception as error:
  allowed={"camera_guard_unavailable","hub_disk_reserve_for_build",
    "probe_source_untrusted","probe_contains_unapproved_capability",
    "probe_manifest_unapproved_permission","probe_manifest_drift",
    "android_platform_jar_unavailable","bounded_build_failed",
    "unexpected_probe_classes","unexpected_probe_dex",
    "apk_dex_packaging_failed","signed_probe_size_invalid",
    "package_inventory_unavailable","probe_package_preexisting_not_touched",
    "disposable_install_failed","disposable_install_unconfirmed",
    "disposable_broadcast_failed","probe_logcat_unavailable",
    "probe_aggregate_result_missing","probe_aggregate_result_invalid",
    "disposable_probe_uninstall_failed","disposable_probe_still_present",
    "shared_camera_lock_unavailable","camera_worker_busy",
    "temperature_too_high_for_probe","incorrect_phone","android_version_drift",
    "camera_pid_untrusted","disposable_package_already_installed",
    "camera_pid_changed","native_4k_pipeline_unhealthy",
    "native_4k_temperature_guard","native_4k_buffer_not_ready",
    "native_4k_recording_in_progress","s9_background_work_queued"}
  code=str(error)
  output={"status":"deferred_or_failed",
          "reason":code if code in allowed else "unclassified_safe_refusal",
          "camera_apk_modified":False,"media_bytes_read":0,
          "originals_modified":False,"person_reviews_modified":False}
 print(MARK+json.dumps(output,sort_keys=True,separators=(",",":")),flush=True)
 if output["status"]!="isolated_readonly_storage_probe_verified":
  raise SystemExit(1)
if __name__=="__main__":main()
