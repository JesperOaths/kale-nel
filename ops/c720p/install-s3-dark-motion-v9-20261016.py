#!/usr/bin/env python3
"""Build and install a guarded S3 rear-camera v9 dark-room sensitivity update.

No streaming endpoints added. Current signed v8 APK is saved for rollback.
Keep 5m bedroom timer under Home Assistant, and all ADB privacy changes separate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

BASE=Path("/home/jespern/c720p-home-hub")
ORIG=BASE/"build/s3-screen-off-v8"
STAGE=BASE/"build/s3-night-motion-v9"
ROLLBACK=BASE/"backups/s3-night-motion-v9/installed-v8-before-v9.apk"
SRC=Path("src/nl/kalenel/s3motion/MotionActivity.java")
SERIAL="192.168.178.47:5555"
APP="nl.kalenel.s3motion"
CANDIDATE_OLD="fraction>.025f && fraction<.40f"
CANDIDATE_NEW="fraction>(dark ? .015f : .025f) && fraction<.40f"
VERSION_OLD="version=8 rear_only=true headless_camera=true"
VERSION_NEW="version=9 rear_only=true headless_camera=true dark_fraction_0.015"
def run(args,timeout=75,cwd=None):
 p=subprocess.run([str(x) for x in args],capture_output=True,
  text=True,timeout=timeout,cwd=cwd)
 if p.returncode:
  raise RuntimeError("command_failed:"+str(args[0])+":"+(p.stderr or p.stdout)[-250:])
 return p.stdout
def adb(*args,timeout=35):
 return run(["adb","-s",SERIAL,*args],timeout=timeout)
def patch(text):
 if text.count(CANDIDATE_OLD)!=1 or text.count(VERSION_OLD)!=1:
  raise RuntimeError("unknown_v8_motion_source")
 out=text.replace(CANDIDATE_OLD,CANDIDATE_NEW,1)
 out=out.replace(VERSION_OLD,VERSION_NEW,1)
 if "hitCount>=3 && recent>=2" not in out:
  raise RuntimeError("existing_temporal_confirmation_changed")
 if "boolean exposure=Math.abs(shift)>20 || fraction>.52f" not in out:
  raise RuntimeError("existing_exposure_guard_changed")
 if "postMotion(session,sequence)" not in out:
  raise RuntimeError("motion_webhook_broken")
 if "ServerSocket" in out or "SocketServer" in out:
  raise RuntimeError("new_network_server_not_allowed")
 return out
def source_checks():
 java=(ORIG/SRC).read_text()
 manifest=(ORIG/"AndroidManifest.xml").read_text()
 if manifest.count('android:versionCode="8"')!=1:
  raise RuntimeError("manifest_not_v8")
 changed=patch(java)
 updated=manifest.replace('android:versionCode="8"','android:versionCode="9"',1)
 updated=updated.replace('android:versionName="8.0"','android:versionName="9.0"',1)
 if java==changed or manifest==updated:raise RuntimeError("no_patch")
 return changed,updated
def cert(path):
 output=run(["apksigner","verify","--print-certs",path],timeout=24)
 found=re.search(r"Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})",output)
 if not found:raise RuntimeError("signer_digest_unavailable")
 return found.group(1)
def current():
 cam=adb("shell","dumpsys","media.camera",timeout=18)
 owned="Client Package Name: "+APP in cam.split("Prior client events",1)[0]
 logs=adb("logcat","-d","-s","S3MOTION:I","*:S",timeout=18)
 heart=re.findall(r"HEARTBEAT session=([0-9]+)[^\n]*?frames=([0-9]+)",logs)
 version=re.findall(r"APP_START session=[^\n]*?version=([0-9]+)",logs)
 return {"camera":owned,"session":heart[-1][0] if heart else None,
  "frames":int(heart[-1][1]) if heart else None,
  "version_seen":int(version[-1]) if version else None}
def build(java,manifest):
 for directory in [STAGE/"src",STAGE/"classes",STAGE/"dex",ROLLBACK.parent]:
  directory.mkdir(parents=True,exist_ok=True)
 shutil.copytree(ORIG/"src",STAGE/"src",dirs_exist_ok=True)
 (STAGE/SRC).write_text(java)
 (STAGE/"AndroidManifest.xml").write_text(manifest)
 jars=sorted(Path("/usr/lib/android-sdk/platforms").glob("*/android.jar"))
 if not jars:raise RuntimeError("android_sdk_not_installed")
 androidjar=jars[-1]
 for old in (STAGE/"classes").rglob("*.class"):old.unlink()
 java_files=list((STAGE/"src/nl/kalenel/s3motion").glob("*.java"))
 if not java_files:raise RuntimeError("no_java")
 run(["javac","-source","8","-target","8","-cp",androidjar,
      "-d",STAGE/"classes"]+java_files,timeout=80)
 for old in (STAGE/"dex").glob("classes*.dex"):old.unlink()
 classes=list((STAGE/"classes").rglob("*.class"))
 run(["d8","--min-api","19","--lib",androidjar,
      "--output",STAGE/"dex"]+classes,timeout=100)
 unsigned=STAGE/"s3-motion-v9-unsigned.apk"
 run(["aapt","package","-f","-M",STAGE/"AndroidManifest.xml",
      "-I",androidjar,"-F",unsigned],timeout=50)
 run(["aapt","add",str(unsigned),"classes.dex"],
     timeout=50,cwd=str(STAGE/"dex"))
 key=BASE/"state/s3-motion-signing.keystore"
 passwd=BASE/"state/s3-motion-signing-password"
 if not key.is_file() or not passwd.is_file():
  raise RuntimeError("original_signing_keystore_missing")
 info=run(["keytool","-list","-v","-keystore",key,
           "-storepass",passwd.read_text().strip()],timeout=40)
 alias=re.search(r"(?im)^Alias name:\s*([^\s]+)",info)
 if not alias:raise RuntimeError("signer_alias_missing")
 signed=STAGE/"s3-motion-v9-signed.apk"
 run(["apksigner","sign","--ks",key,"--ks-key-alias",alias.group(1),
      "--ks-pass","file:"+str(passwd),"--out",signed,unsigned],timeout=80)
 if signed.stat().st_size<19000:raise RuntimeError("unexpected_apk_size")
 return signed
def install_and_verify(signed):
 path=adb("shell","pm","path",APP).strip().partition("package:")[2].strip()
 if not path.startswith("/data/app/") or not path.endswith(".apk"):
  raise RuntimeError("installed_v8_path_unexpected")
 if not ROLLBACK.exists():
  adb("pull",path,str(ROLLBACK),timeout=110)
 if ROLLBACK.stat().st_size<19000:raise RuntimeError("rollback_invalid")
 if cert(ROLLBACK)!=cert(signed):raise RuntimeError("APK_signer_mismatch")
 old=adb("shell","dumpsys","package",APP,timeout=20)
 if "versionCode=8 " not in old:raise RuntimeError("installed_version_not_8")
 initial=current()
 if not initial["camera"]:raise RuntimeError("camera_inactive_before_update")
 before_sockets=adb("shell","netstat","-lnt",timeout=20)
 installing=False
 try:
  result=adb("install","-r","-g",str(signed),timeout=110)
  if "Success" not in result:raise RuntimeError("APK_install_not_success")
  installing=True
  adb("shell","am","start","-n",APP+"/.MotionActivity",timeout=20)
  time.sleep(12)
  a=current()
  time.sleep(14)
  b=current()
  if not (a["camera"] and b["camera"] and
     a["frames"] is not None and b["frames"] is not None and
     a["session"]==b["session"] and b["frames"]>a["frames"]+12 and
     b["version_seen"]==9):
   raise RuntimeError("camera_frames_or_v9_not_confirmed")
  after_sockets=adb("shell","netstat","-lnt",timeout=20)
  def listeners(raw):
   return sorted(x.strip() for x in raw.splitlines() if "LISTEN" in x)
  if listeners(before_sockets)!=listeners(after_sockets):
   raise RuntimeError("unexpected_new_network_listener")
  power=adb("shell","dumpsys","power",timeout=18)
  if "mWakefulness=Awake" in power:
   adb("shell","input","keyevent","26",timeout=15)
   time.sleep(6)
   if not current()["camera"]:
    raise RuntimeError("screen_off_stopped_motion")
  return {"before":initial,"after":b,"headless_camera":True,
          "new_listening_servers":0}
 except Exception:
  if installing:
   adb("install","-r","-g",str(ROLLBACK),timeout=110)
   adb("shell","am","start","-n",APP+"/.MotionActivity",timeout=20)
  raise

def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 java,manifest=source_checks()
 report={"mode":"apply" if args.apply else "dry_run",
     "camera_app":APP,"low_light_minimum_changed_fraction":.015,
     "day_minimum_changed_fraction":.025,
     "exposure_flicker_guard_preserved":True,
     "three_hit_confirmation_preserved":True}
 if not args.apply:
  print("S3_DARK_MOTION_V9 "+json.dumps(report),flush=True);return
 signed=build(java,manifest)
 report.update(install_and_verify(signed))
 report["result"]="installed_and_live_camera_verified"
 report["sha256"]=hashlib.sha256(signed.read_bytes()).hexdigest()
 print("S3_DARK_MOTION_V9 "+json.dumps(report,sort_keys=True),flush=True)
if __name__=="__main__":main()
