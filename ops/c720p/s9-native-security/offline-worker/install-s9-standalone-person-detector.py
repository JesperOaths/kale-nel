#!/usr/bin/env python3
"""Install independent Android TFLite quantized SSD ROI worker on S9+.

Uses a SHA-verified read-only COPY of the installed Camera2 app's detector
assets and official TensorFlow Lite CPU 2.16.1 AAR. Never installs/patches
an APK or touches the camera service, media, or review databases.
"""
import argparse
import hashlib
import io
import os
import json
import pathlib
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

PHONE="192.168.178.250:5555"
WORKER="/data/local/tmp/s9_worker"
MODEL_SHA="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
LABEL_SHA="c7e79c855f73cbba9f33d649d60e1676eb0a974021a41696d1ac0d4b7f7e0211"
API="2.16.1"
MAVEN="https://repo.maven.apache.org/maven2/org/tensorflow"
ANDROID_JAR=os.environ.get("S9_ANDROID_SDK_JAR","/usr/lib/android-sdk/platforms/android-36/android.jar")
SRC=pathlib.Path(__file__).with_name("S9StandalonePersonRoi.java")
MODEL_FILES={
 "person_detect.tflite":("assets/detect.tflite",MODEL_SHA),
 "labelmap.txt":("assets/labelmap.txt",LABEL_SHA),
}


def digest(p):
    with p.open("rb") as file:
        sha=hashlib.sha256()
        for part in iter(lambda:file.read(65536),b""):
            sha.update(part)
    return sha.hexdigest()


def run(argv,timeout=90):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("Operation failed "+argv[0]+" "+p.stderr[-350:])
    return p.stdout.strip()


def adb(*argv,timeout=65):
    return run(["adb","-s",PHONE,*argv],timeout=timeout)


def fetch_maven(name,out):
    url=MAVEN+"/"+name.replace("-api","")+"/"+API+"/"+name+"-"+API+".aar"
    # Lite API artifact has a separate directory named tensorflow-lite-api.
    base=MAVEN+"/"+name+"/"+API+"/"+name+"-"+API+".aar"
    req=urllib.request.Request(base,headers={"User-Agent":"S9OfflineROIBuild/1"})
    with urllib.request.urlopen(req,timeout=45) as response,out.open("wb") as file:
        total=0
        while True:
            data=response.read(65536)
            if not data:break
            total+=len(data)
            if total>32_000_000:raise RuntimeError("Unexpectedly large TensorFlow Lite AAR")
            file.write(data)
    with zipfile.ZipFile(out) as z:
        assert "classes.jar" in z.namelist()
    return digest(out)


def read_apk(folder):
    paths=adb("shell","pm path nl.kalenel.s9security",timeout=20)
    package=next((line[8:].strip() for line in paths.splitlines()
                  if line.startswith("package:")),None)
    if not package or not package.startswith("/data/app/") or not package.endswith(".apk"):
        raise RuntimeError("Cannot locate verified installed APK for read-only asset extraction")
    apk=folder/"source-camera-apk-readonly.apk"
    adb("pull",package,str(apk),timeout=85)
    if not 1_000_000<apk.stat().st_size<75_000_000:
        raise RuntimeError("Unexpected camera APK size")
    result={}
    with zipfile.ZipFile(apk) as z:
        for name,(key,expected) in MODEL_FILES.items():
            raw=z.read(key)
            output=folder/name
            output.write_bytes(raw)
            if digest(output)!=expected:
                raise RuntimeError("Installed camera detector assets differ from verified model")
            result[name]=output
    return result


def compile_worker(folder):
    if not pathlib.Path(ANDROID_JAR).is_file() or not SRC.is_file():
        raise RuntimeError("Android SDK or independent worker source missing")
    aars={}
    jars=[]
    for name in ("tensorflow-lite","tensorflow-lite-api"):
        aar=folder/(name+".aar")
        aars[name]=fetch_maven(name,aar)
        jar=folder/(name+".jar")
        with zipfile.ZipFile(aar) as z:
            jar.write_bytes(z.read("classes.jar"))
            if name=="tensorflow-lite":
                jni="jni/arm64-v8a/libtensorflowlite_jni.so"
                lib=folder/"libtensorflowlite_jni.so"
                lib.write_bytes(z.read(jni))
                if not 1_000_000<lib.stat().st_size<20_000_000:
                    raise RuntimeError("Official Android JNI library invalid")
        jars.append(jar)
    classes=folder/"classes";classes.mkdir()
    run(["javac","-source","8","-target","8",
         "-cp",":".join(str(p) for p in jars)+":"+ANDROID_JAR,
         "-d",str(classes),str(SRC)],timeout=90)
    objects=list(classes.rglob("*.class"))
    if not objects:raise RuntimeError("No standalone decoder classes")
    dex=folder/"dex";dex.mkdir()
    run(["d8","--min-api","28","--lib",ANDROID_JAR,"--output",str(dex),
         *map(str,jars),*map(str,objects)],timeout=120)
    dex_file=dex/"classes.dex"
    if not dex_file.is_file() or dex_file.stat().st_size<20_000:
        raise RuntimeError("Standalone TensorFlow Lite DEX is invalid")
    jar=folder/"s9-offline-person-detector.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as z:
        z.write(dex_file,"classes.dex")
    return jar,folder/"libtensorflowlite_jni.so",aars


def deploy(root,artifacts):
    initial=adb("shell","pidof nl.kalenel.s9security",timeout=18)
    if not initial.strip() or not all(ch.isdigit() or ch.isspace() for ch in initial):
        raise RuntimeError("Camera2 live process cannot be verified")
    adb("shell","mkdir -p "+WORKER+"/models "+WORKER+"/lib",timeout=18)
    staged=[]
    for local,remote in artifacts:
        if not local.is_file():raise RuntimeError("Missing required staging artifact")
        expected=digest(local)
        existing=subprocess.run(["adb","-s",PHONE,"shell","test -e "+remote],
                                capture_output=True,timeout=15)
        if existing.returncode==0:
            remote_hash=adb("shell","sha256sum "+remote,timeout=50).split()[0]
            if remote_hash!=expected:
                raise RuntimeError("Differing prior worker artifact: refusing overwrite")
            continue
        temp=remote+".pending"
        adb("push",str(local),temp,timeout=55)
        received=adb("shell","sha256sum "+temp,timeout=60).split()[0]
        if received!=expected:raise RuntimeError("Phone artifact SHA256 mismatch")
        adb("shell","mv "+temp+" "+remote+"; chmod 600 "+remote,timeout=22)
        final=adb("shell","sha256sum "+remote,timeout=60).split()[0]
        if final!=expected:raise RuntimeError("Phone artifact readback SHA256 failed")
        staged.append(pathlib.PurePosixPath(remote).name)
    after=adb("shell","pidof nl.kalenel.s9security",timeout=18)
    if after!=initial:raise RuntimeError("Camera2 process changed during separate staging")
    return staged


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    parser.add_argument("--compile-only",action="store_true")
    args=parser.parse_args()
    if args.compile_only and args.install:
        raise RuntimeError("Compilation-only must not install on S9+")
    if shutil.disk_usage("/tmp").free<240_000_000:
        raise RuntimeError("C720P scratch free space below 240MB safety reserve")
    with tempfile.TemporaryDirectory(prefix="s9-ssd-offline-") as d:
        root=pathlib.Path(d)
        models={} if args.compile_only else read_apk(root)
        jar,lib,aars=compile_worker(root)
        if args.compile_only:
            print("S9_STANDALONE_TFLITE_DETECTOR_COMPILED "+json.dumps({
                "dex_sha256":digest(jar),"native_sha256":digest(lib),
                "official_aars":aars,"apk_read":False,
                "camera_apk_modified":False,"recordings_modified":False}),flush=True)
            return
        artifacts=[(jar,WORKER+"/s9-offline-person-detector.jar"),
                   (lib,WORKER+"/lib/libtensorflowlite_jni.so"),
                   (models["person_detect.tflite"],WORKER+"/models/person_detect.tflite"),
                   (models["labelmap.txt"],WORKER+"/models/labelmap.txt")]
        installed=deploy(root,artifacts) if args.install else []
        print("S9_STANDALONE_TFLITE_DETECTOR_"+("INSTALLED" if args.install else "COMPILED")
              +" "+json.dumps({"model_sha256":MODEL_SHA,
                "labelmap_sha256":LABEL_SHA,
                "native_sha256":digest(lib),"dex_sha256":digest(jar),
                "official_aars":aars,"new_files":installed,
                "camera_apk_modified":False,"recording_service_restarted":False,
                "originals_modified":False,"review_decisions_modified":False}),flush=True)


if __name__=="__main__":main()
