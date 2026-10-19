#!/usr/bin/env python3
"""Install a standalone ORT Java+ARM64 worker beside, not inside, Camera2.

C720P is solely build/ADB transport. No C720P model inference, no APK install,
no service restart, no Security4K media write, no private video access.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION="1.22.0"
AAR_URI=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
         "onnxruntime-android/"+VERSION+"/onnxruntime-android-"+VERSION+".aar")
AAR_SHA256="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
AAR_MAX=30000000
PHONE="192.168.178.250:5555"
PHONE_ROOT="/data/local/tmp/s9_worker"
REMOTE_CLASS="nl.kalenel.s9offline.S9OnnxRuntimeWorker"
WORKER_SOURCE="S9OnnxRuntimeWorker.java"
EXPECTED={"classes.jar","jni/arm64-v8a/libonnxruntime.so",
          "jni/arm64-v8a/libonnxruntime4j_jni.so"}


def exec_checked(argv, timeout=70):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("external command failed: "+argv[0]+
                           " stderr="+p.stderr.strip()[:350])
    return p.stdout.strip()


def phone(shell):
    return exec_checked(["adb","-s",PHONE,"shell",shell],timeout=30)


def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(65536),b""):
            h.update(chunk)
    return h.hexdigest()


def preflight():
    devices=exec_checked(["adb","devices"],timeout=15)
    if PHONE+"\tdevice" not in devices:
        raise RuntimeError("S9 ADB unavailable")
    if phone("getprop ro.product.cpu.abi")!="arm64-v8a":
        raise RuntimeError("Expected ARM64 Android phone")
    if phone("getprop ro.build.version.sdk")!="29":
        raise RuntimeError("Expected Android 10 runtime")
    recorder=phone("pidof nl.kalenel.s9security")
    if not re.fullmatch(r"[0-9 ]+",recorder):
        raise RuntimeError("Current camera PID unavailable")
    if shutil.disk_usage("/tmp").free<120000000:
        raise RuntimeError("C720P /tmp headroom too low")
    if shutil.disk_usage("/").free<180000000:
        raise RuntimeError("C720P root headroom too low")
    return recorder


def build(artifact, workspace):
    uri=AAR_URI
    amount=0
    with urllib.request.urlopen(
        urllib.request.Request(uri,headers={"User-Agent":"S9Worker/1"}),
        timeout=35) as response, open(artifact,"wb") as dest:
        if response.status != 200:raise RuntimeError("AAR HTTP status invalid")
        while True:
            chunk=response.read(65536)
            if not chunk:break
            amount+=len(chunk)
            if amount>AAR_MAX:raise RuntimeError("AAR exceeded size bound")
            dest.write(chunk)
    if sha(artifact)!=AAR_SHA256:
        raise RuntimeError("Official AAR SHA256 mismatch")
    libdir=workspace/"lib";libdir.mkdir()
    with zipfile.ZipFile(artifact) as z:
        if not EXPECTED.issubset(set(z.namelist())):
            raise RuntimeError("ORT AAR required members missing")
        classjar=workspace/"onnxruntime-java.jar"
        classjar.write_bytes(z.read("classes.jar"))
        for name in EXPECTED:
            if name.startswith("jni/"):
                target=libdir/Path(name).name
                with z.open(name) as source, open(target,"wb") as dest:
                    shutil.copyfileobj(source,dest,1024*1024)
                if not 10000<target.stat().st_size<25000000:
                    raise RuntimeError("Unexpected ARM64 binary size")
    src=Path(__file__).with_name(WORKER_SOURCE)
    if not src.is_file() or src.is_symlink():
        raise RuntimeError("Worker Java source missing")
    classes=workspace/"classes";classes.mkdir()
    exec_checked(["javac","-source","8","-target","8","-cp",str(classjar),
                  "-d",str(classes),str(src)],timeout=70)
    dex=workspace/"dex";dex.mkdir()
    blobs=sorted(str(x) for x in classes.rglob("*.class"))
    if not blobs:raise RuntimeError("No compiled Java classes")
    exec_checked(["d8","--min-api","29","--output",str(dex),
                  str(classjar),*blobs],timeout=100)
    dexfile=dex/"classes.dex"
    if not dexfile.is_file() or dexfile.stat().st_size<2000:
        raise RuntimeError("No standalone classes.dex")
    output=workspace/"s9-worker.jar"
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as z:
        z.write(dexfile,"classes.dex")
    return [output,libdir/"libonnxruntime.so",libdir/"libonnxruntime4j_jni.so"]


def transfer(files):
    # Install separate versioned files, not an APK. Avoid touching camera app.
    phone("umask 077; mkdir -p "+PHONE_ROOT+"/lib; chmod 700 "+PHONE_ROOT+" "+PHONE_ROOT+"/lib")
    remote=[PHONE_ROOT+"/s9-worker.jar",
            PHONE_ROOT+"/lib/libonnxruntime.so",
            PHONE_ROOT+"/lib/libonnxruntime4j_jni.so"]
    for local,target in zip(files,remote):
        tmp=target+".partial"
        exec_checked(["adb","-s",PHONE,"push",str(local),tmp],timeout=80)
        digest=phone("sha256sum "+tmp).split()[0]
        if digest!=sha(local):raise RuntimeError("Phone binary hash mismatch")
        phone("mv "+tmp+" "+target+"; chmod 600 "+target)
        if phone("sha256sum "+target).split()[0]!=sha(local):
            raise RuntimeError("Installed file did not verify")


def runtime_test():
    command=("export LD_LIBRARY_PATH="+PHONE_ROOT+"/lib; "
             "export CLASSPATH="+PHONE_ROOT+"/s9-worker.jar; "
             "app_process -Djava.library.path="+PHONE_ROOT+"/lib "
             "/system/bin "+REMOTE_CLASS+" --runtime-test")
    report=phone(command)
    if "S9_STANDALONE_ORT_NATIVE_LOAD_PASS" not in report:
        raise RuntimeError("Java/JNI native runtime not confirmed")
    return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    args=parser.parse_args()
    preflight()
    if not args.install:
        print("S9_STANDALONE_ORT_PREFLIGHT_PASS "+json.dumps({
            "aar_version":VERSION,"aar_sha256":AAR_SHA256,
            "abi":"arm64-v8a","camera_apk_unchanged":True,
            "install_requested":False}),flush=True)
        return
    with tempfile.TemporaryDirectory(prefix="s9-ort-build-") as root:
        workspace=Path(root)
        bundle=workspace/"onnxruntime.aar"
        files=build(bundle,workspace)
        transfer(files)
        report=runtime_test()
        after=phone("pidof nl.kalenel.s9security")
        if not re.fullmatch(r"[0-9 ]+",after):
            raise RuntimeError("Camera process health changed")
        print("S9_STANDALONE_ORT_INSTALLED_VERIFIED "+json.dumps({
            "aar_version":VERSION,"aar_sha256":AAR_SHA256,
            "phone_root":PHONE_ROOT,"android_arm64":True,
            "native_load_test":report,
            "camera_apk_modified":False,"recordings_modified":False,
            "camera_service_manipulated":False}),flush=True)


if __name__=="__main__":
    main()
