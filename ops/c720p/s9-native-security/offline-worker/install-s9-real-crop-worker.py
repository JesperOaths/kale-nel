#!/usr/bin/env python3
"""Build and deploy ONLY separate real-crop DEX jar to S9+ worker directory.

Official ORT ARM64 runtime was installed independently. This code neither
installs an APK nor alters the live camera / recorder / archive.
"""
import argparse,hashlib,json,pathlib,subprocess,tempfile,urllib.request,zipfile,os
PHONE="192.168.178.250:5555"
ROOT="/data/local/tmp/s9_worker"
VERSION="1.22.0"
URL=("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/"
     "onnxruntime-android/"+VERSION+"/onnxruntime-android-"+VERSION+".aar")
AAR_SHA="04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2"
ANDROID_JAR="/usr/lib/android-sdk/platforms/android-36/android.jar"


def run(cmd,timeout=90):
    r=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
    if r.returncode:
        raise RuntimeError("Command failed: "+cmd[0]+" "+r.stderr[-350:])
    return r.stdout.strip()


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build(base):
    jar=base/"runtime.aar"
    with urllib.request.urlopen(URL,timeout=40) as response,jar.open("wb") as output:
        count=0
        while True:
            chunk=response.read(65536)
            if not chunk:break
            count+=len(chunk)
            if count>30_000_000:raise RuntimeError("AAR oversize")
            output.write(chunk)
    if sha(jar)!=AAR_SHA:raise RuntimeError("Untrusted ORT Java library")
    with zipfile.ZipFile(jar) as z:
        (base/"ort.jar").write_bytes(z.read("classes.jar"))
    if not pathlib.Path(ANDROID_JAR).is_file():
        raise RuntimeError("C720P Android SDK jar unavailable")
    classes=base/"classes";classes.mkdir()
    src=pathlib.Path(__file__).with_name("S9OnnxCropWorker.java")
    run(["javac","-source","8","-target","8",
         "-cp",str(base/"ort.jar")+":"+ANDROID_JAR,
         "-d",str(classes),str(src)],75)
    dex=base/"dex";dex.mkdir()
    run(["d8","--min-api","29","--output",str(dex),
         str(base/"ort.jar"),*[str(p) for p in classes.rglob("*.class")]],90)
    candidate=base/"s9-crop-worker.jar"
    with zipfile.ZipFile(candidate,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.write(dex/"classes.dex","classes.dex")
    if not 1000<candidate.stat().st_size<1_000_000:
        raise RuntimeError("Unexpected DEX package size")
    return candidate


def install(jar):
    remote=ROOT+"/s9-crop-worker.jar"
    staging=remote+".pending"
    run(["adb","-s",PHONE,"push",str(jar),staging],45)
    if run(["adb","-s",PHONE,"shell","sha256sum "+staging]).split()[0]!=sha(jar):
        raise RuntimeError("DEX received incorrectly by S9")
    run(["adb","-s",PHONE,"shell",
         "mv "+staging+" "+remote+"; chmod 600 "+remote],20)
    if run(["adb","-s",PHONE,"shell","sha256sum "+remote]).split()[0]!=sha(jar):
        raise RuntimeError("Verified DEX not installed")
    # DO NOT invoke real crop scanning on install.
    recorder=run(["adb","-s",PHONE,"shell",
                  "pidof nl.kalenel.s9security"])
    if not recorder.isdigit():
        raise RuntimeError("Camera recorder baseline missing")


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--install",action="store_true")
    a=p.parse_args()
    with tempfile.TemporaryDirectory(prefix="s9-crop-dex-") as folder:
        result=build(pathlib.Path(folder))
        if a.install:install(result)
        print("S9_STANDALONE_REAL_CROP_DEX_"+("INSTALLED" if a.install else "COMPILED")+
              " "+json.dumps({"sha256":sha(result),"bytes":result.stat().st_size,
                              "separate_from_camera":True,
                              "recordings_modified":False,
                              "metadata_records_modified":False}),flush=True)


if __name__=="__main__":main()
