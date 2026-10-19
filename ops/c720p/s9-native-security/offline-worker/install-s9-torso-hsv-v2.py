#!/usr/bin/env python3
"""Build standalone Android HSV32 descriptor DEX without camera APK access."""
import argparse,hashlib,json,pathlib,subprocess,tempfile,zipfile,shutil
PHONE="192.168.178.250:5555"
ROOT="/data/local/tmp/s9_worker"
SRC=pathlib.Path(__file__).with_name("S9OfflineTorsoHistogramV2.java")
ANDROID="/usr/lib/android-sdk/platforms/android-36/android.jar"


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def call(args,seconds=75):
    result=subprocess.run(args,capture_output=True,text=True,timeout=seconds)
    if result.returncode:
        raise RuntimeError("Command failed: "+args[0]+" "+result.stderr[-260:])
    return result.stdout.strip()


def build(folder):
    if not SRC.is_file() or not pathlib.Path(ANDROID).is_file():
        raise RuntimeError("Independent source or Android SDK missing")
    classes=folder/"classes";classes.mkdir()
    call(["javac","-source","8","-target","8","-cp",ANDROID,
          "-d",str(classes),str(SRC)],90)
    objects=list(classes.rglob("*.class"))
    if not objects:raise RuntimeError("No descriptor classes")
    dex=folder/"dex";dex.mkdir()
    call(["d8","--min-api","28","--lib",ANDROID,"--output",str(dex),
         *map(str,objects)],75)
    jar=folder/"s9-torso-hsv-v2.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as z:
        z.write(dex/"classes.dex","classes.dex")
    if not 1000<jar.stat().st_size<150000:
        raise RuntimeError("Unexpected standalone descriptor DEX size")
    return jar


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--install",action="store_true")
    args=p.parse_args()
    if shutil.disk_usage("/tmp").free<60*1024*1024:
        raise RuntimeError("Hub disk safety reserve")
    with tempfile.TemporaryDirectory(prefix="s9-hsv-v2-dex-") as folder:
        jar=build(pathlib.Path(folder))
        added=False
        if args.install:
            target=ROOT+"/s9-torso-hsv-v2.jar"
            camera=call(["adb","-s",PHONE,"shell","pidof nl.kalenel.s9security"],15)
            if not camera.strip():raise RuntimeError("Camera baseline unavailable")
            exists=subprocess.run(["adb","-s",PHONE,"shell","test -e "+target],
                                  capture_output=True,timeout=15).returncode==0
            if exists:
                observed=call(["adb","-s",PHONE,"shell","sha256sum "+target],25).split()[0]
                if observed!=sha(jar):
                    raise RuntimeError("Private descriptor DEX differs; refuse overwrite")
            else:
                temp=target+".pending"
                call(["adb","-s",PHONE,"push",str(jar),temp],40)
                if call(["adb","-s",PHONE,"shell","sha256sum "+temp],20).split()[0]!=sha(jar):
                    raise RuntimeError("Phone descriptor DEX SHA mismatch")
                call(["adb","-s",PHONE,"shell","mv "+temp+" "+target+"; chmod 600 "+target],20)
                added=True
            if call(["adb","-s",PHONE,"shell","pidof nl.kalenel.s9security"],15)!=camera:
                raise RuntimeError("Live recorder PID changed")
        print("S9_UNIFORM_HSV32_V2_DEX_"+("INSTALLED" if args.install else "COMPILED")+
              " "+json.dumps({"sha256":sha(jar),"bytes":jar.stat().st_size,
                "added_new_file":added,"source_crops_modified":False,
                "camera_apk_modified":False,"person_assignments_modified":False}),flush=True)


if __name__=="__main__":main()
