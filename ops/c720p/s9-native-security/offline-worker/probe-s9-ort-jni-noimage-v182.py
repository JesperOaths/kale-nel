#!/usr/bin/env python3
"""One small S9+ native ORT environment initialization, NO model/images.

Discriminates Android Java startup (already passed #12152) from the ORT JNI
loader. Uses the existing V166 camera/lock safeguards and verifies an immutable
Android 1.22 AAR SHA. Never touches Camera2, originals, thumbnails or reviews.
"""
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

HERE=Path(__file__).resolve().parent
LIB=HERE/"probe-s9-app-process-noimage-v166.py"
SRC=HERE/"S9OrtJniNoImageV182.java"
AAR_URL=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
         "onnxruntime-android/1.22.0/onnxruntime-android-1.22.0.aar")
AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
MARK="S9_ORT_JNI_NO_IMAGE_V182 "
CLASS="nl.kalenel.s9offline.S9OrtJniNoImageV182"
EXPECTED="S9_ORT_JNI_NO_IMAGE_ENV_OK_V182"
MAX_AAR=30_000_000
def load_guard():
    if not LIB.is_file() or LIB.is_symlink():raise RuntimeError("v166_guard_unavailable")
    spec=importlib.util.spec_from_file_location("s9_ort_baseline_guard_v166",str(LIB))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def jar_for_android(tmp,guard):
    if SRC.is_symlink() or not SRC.is_file() or not 150<SRC.stat().st_size<5000:
        raise guard.Stop("unexpected_noimage_java_source")
    if not guard.AND_JAR.is_file() or guard.AND_JAR.is_symlink():
        raise guard.Stop("android_sdk_unavailable")
    if shutil.disk_usage("/").free<850*1024*1024:
        raise guard.Stop("hub_disk_reserve_low")
    req=urllib.request.Request(AAR_URL,headers={"User-Agent":"S9NoImageORT/1"})
    with urllib.request.urlopen(req,timeout=38) as response:
        if response.status!=200:raise guard.Stop("official_ort_aar_unavailable")
        blob=response.read(MAX_AAR+1)
    if len(blob)>MAX_AAR or hashlib.sha256(blob).hexdigest()!=AAR_SHA:
        raise guard.Stop("official_ort_aar_sha_changed")
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        api=archive.read("classes.jar")
    api_jar=tmp/"official-ort-android-classes.jar"
    api_jar.write_bytes(api)
    classes=tmp/"classes";classes.mkdir()
    javac=guard.call(["javac","-source","8","-target","8",
          "-cp",str(api_jar),"-d",str(classes),str(SRC)],35)
    guard.require(javac.returncode==0,"noimage_ort_java_compile_failed")
    compiled=list(classes.rglob("*.class"))
    guard.require(len(compiled)==1,"unexpected_noimage_ort_classes")
    dex=tmp/"dex";dex.mkdir()
    build=guard.call(["d8","--min-api","28","--lib",str(guard.AND_JAR),
                 "--output",str(dex),str(api_jar),str(compiled[0])],75)
    guard.require(build.returncode==0,"noimage_ort_dex_compile_failed")
    target=dex/"classes.dex"
    guard.require(target.is_file() and 1000<target.stat().st_size<4*1024*1024,
                  "noimage_ort_dex_size_invalid")
    jar=tmp/"s9-ort-noimage-v182.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as z:
        z.write(target,"classes.dex")
    guard.require(1000<jar.stat().st_size<4*1024*1024,"unexpected_dex_jar_size")
    return jar

def launch_once(guard,target):
    # The two already installed native libraries are read-only prerequisites.
    for name in ("libonnxruntime.so","libonnxruntime4j_jni.so"):
        digest=guard.phone_digest(guard.WORKER+"/lib/"+name)
        guard.require(bool(guard.SHA.fullmatch(digest)),"unverified_ort_library_presence")
    command=("export LD_LIBRARY_PATH="+guard.WORKER+"/lib; "
             "export CLASSPATH="+target+"; "
             "app_process -Djava.library.path="+guard.WORKER+"/lib "
             "/system/bin "+CLASS+" --no-image-ort-env")
    try:result=guard.adb("shell",command,seconds=18)
    except guard.Stop:
        return {"success":False,"reason":"bounded_native_bootstrap_transport_failure"}
    if result.returncode==0 and result.stdout.strip()==EXPECTED:
        return {"success":True,"reason":"native_ort_environment_initialized"}
    if result.returncode in (137,-9) or re.search(r"\\bkilled\\b",
                 result.stderr+" "+result.stdout,re.I):
        return {"success":False,"reason":"native_ort_environment_terminated"}
    if "UnsatisfiedLinkError" in result.stderr or "NoClassDefFoundError" in result.stderr:
        return {"success":False,"reason":"native_ort_java_dependency_error"}
    return {"success":False,"reason":"native_ort_environment_not_verified"}

def run(guard):
    guard.require(guard.LOCK.is_file() and not guard.LOCK.is_symlink(),
                  "shared_s9_backfill_lock_unavailable")
    with guard.LOCK.open("r") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise guard.Stop("s9_offline_worker_busy") from None
        first=guard.current_camera()
        guard.require(guard.must_adb("get-state")=="device","phone_not_connected")
        guard.require(guard.must_adb("shell","getprop ro.product.model")==guard.MODEL,
                      "wrong_phone_device")
        pid=guard.must_adb("shell","pidof nl.kalenel.s9security")
        guard.require(bool(guard.PID.fullmatch(pid)),"camera_pid_unavailable")
        with tempfile.TemporaryDirectory(prefix="s9-ort-noimage-v182-") as folder:
            jar=jar_for_android(Path(folder),guard)
            guard.current_camera()
            digest=hashlib.sha256(jar.read_bytes()).hexdigest()
            # Dedicated, immutable-by-hash staging, not shared runtime overwrite.
            destination=guard.WORKER+"/s9-ort-noimage-v182-"+digest[:16]+".jar"
            if guard.exists(destination):
                guard.require(guard.phone_digest(destination)==digest,
                              "existing_noimage_ort_worker_drift")
            else:
                part=destination+".pending"
                guard.require(not guard.exists(part),"untrusted_pending_noimage_ort")
                guard.must_adb("push",str(jar),part,seconds=40)
                guard.require(guard.phone_digest(part)==digest,
                              "noimage_ort_transfer_corrupt")
                guard.must_adb("shell","mv "+part+" "+destination+" && chmod 600 "+destination)
                guard.require(guard.phone_digest(destination)==digest,
                              "noimage_ort_final_sha_changed")
            guard.current_camera()
            status=launch_once(guard,destination)
        after=guard.current_camera()
        guard.require(guard.must_adb("shell","pidof nl.kalenel.s9security")==pid,
                      "camera_pid_changed_after_probe")
        return {"status":"one_native_bootstrap_checked",
                "native_ort_environment_started":status["success"],
                "reason":status["reason"],"launch_attempts":1,
                "phone_temperature_before_c":first["temperature_c"],
                "phone_temperature_after_c":after["temperature_c"],
                "capture_dropped_frames_after":after["continuous_4k_dropped_output_frames"],
                "camera_pid_unchanged":True,
                "face_images_read":0,"models_loaded":0,
                "recordings_modified":False,"manual_reviews_modified":False,
                "camera_apk_modified":False,"automatic_person_assignments":0}

def main():
    try:
        guard=load_guard()
        result=run(guard)
    except Exception as error:
        reason=str(error)
        allowed={"shared_s9_backfill_lock_unavailable","s9_offline_worker_busy",
           "native_4k_capture_not_idle_and_cool","phone_not_connected",
           "wrong_phone_device","camera_pid_unavailable","hub_disk_reserve_low",
           "android_sdk_unavailable","official_ort_aar_unavailable",
           "official_ort_aar_sha_changed","unverified_ort_library_presence"}
        result={"status":"deferred","reason":reason if reason in allowed
                else "unverified_no_private_detail",
                "native_ort_environment_started":False,"launch_attempts":0,
                "face_images_read":0,"models_loaded":0,
                "camera_apk_modified":False,"recordings_modified":False}
    print(MARK+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
if __name__=="__main__":main()
