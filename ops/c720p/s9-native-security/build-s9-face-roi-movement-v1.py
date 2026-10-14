#!/usr/bin/env python3
"""Build signed S9 face-ROI + measured image movement release, without FFmpegKit.

Immutably fetch the audited 19-source Android revision and compile. Repackage
only primary classes.dex of the already signed/pinned S9 APK; preserve asset
model bytes, native shared libraries, manifest and secondary runtime dex. Do
NOT install or launch anything; installation requires separate guarded gate.
"""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tempfile,urllib.request,zipfile
HOME=Path("/home/jespern/c720p-home-hub")
REF="9d46ac7209c1dae5088ec7deb5561945ea8bf550"
BASE=HOME/"build/s9-onphone-prepended-mp4-v1c/s9-prepended-v1c.apk"
TARGET=HOME/"build/s9-face-roi-movement-v1"
KEY=Path("/home/jespern/.config/s9-native-security-sign")
FINGERPRINT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
JAVAS=("AnonymousClipTracks","Boot","CameraActivity","CameraControls",
 "CameraOrientation","CameraService","CaptureContinuity","ClipClassifier",
 "EventFrameRanker","GardenArchiveTriage","GardenPersonTrackGate",
 "GardenPreRoll","HistoricalImportWorker","MotionGrid","OutfitEvidence",
 "PhoneMediaRange","PreviewJpeg","RecordingRate","S9FaceReview")
def run(a,sec=200):
 p=subprocess.run(a,text=True,capture_output=True,timeout=sec)
 if p.returncode:raise RuntimeError("command_error "+str(a[:4])+":"+p.stderr[-2200:])
 return p.stdout
def sha(b):return hashlib.sha256(b).hexdigest()
def signcheck(p):
 output=run(["apksigner","verify","--print-certs",str(p)],40)
 if FINGERPRINT not in output:raise RuntimeError("APK_SIGNER_CHANGED")
def main():
 if not BASE.is_file():raise RuntimeError("baseline_signed_apk_missing")
 signcheck(BASE)
 with zipfile.ZipFile(BASE) as apk:
  baseline={n:sha(apk.read(n)) for n in apk.namelist()
   if n=="AndroidManifest.xml" or n.startswith("assets/") or
   n.startswith("lib/") or n=="classes2.dex"}
  original_main=sha(apk.read("classes.dex"))
 if not any(x.endswith("/libtensorflowlite_gpu_jni.so") for x in baseline):
  raise RuntimeError("baseline_gpu_library_missing")
 libs=HOME/"build/s9-person-ml-v1/deps"
 cp=[libs/(x+".jar") for x in
   ("tensorflow-lite","tensorflow-lite-api","tensorflow-lite-gpu","tensorflow-lite-gpu-api")]
 if any(not p.is_file() for p in cp):raise RuntimeError("missing_pinned_tensorflow_libs")
 android=max(Path("/usr/lib/android-sdk/platforms").glob("*/android.jar"))
 with tempfile.TemporaryDirectory(prefix="s9-safe-roi-build-",dir="/tmp") as d:
  p=Path(d);src=p/"src/nl/kalenel/s9security";src.mkdir(parents=True)
  for item in JAVAS:
   url=("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+REF+
        "/ops/c720p/s9-native-security/src/nl/kalenel/s9security/"+item+".java")
   with urllib.request.urlopen(url,timeout=40) as r:raw=r.read(180000)
   if not (100<len(raw)<180000):raise RuntimeError("invalid_source_"+item)
   (src/(item+".java")).write_bytes(raw)
  assert "GardenJoinedClip" not in (src/"CameraService.java").read_text()
  assert "high_resolution_isolated_person_head_roi_v2" in (src/"S9FaceReview.java").read_text()
  assert "imageSpeedBodyHeightsPerSecond" in (src/"AnonymousClipTracks.java").read_text()
  classes=p/"classes";classes.mkdir()
  run(["javac","-source","8","-target","8","-cp",":".join(map(str,[android,*cp])),
    "-d",str(classes),*map(str,src.glob("*.java"))],180)
  if not (classes/"nl/kalenel/s9security/S9FaceReview.class").is_file():
   raise RuntimeError("compiled_face_class_missing")
  dex=p/"dex";dex.mkdir()
  run(["d8","--min-api","26","--lib",str(android),"--output",str(dex),
      *map(str,classes.rglob("*.class")),*map(str,cp)],240)
  outputs=list(dex.glob("classes*.dex"))
  if len(outputs)!=1 or outputs[0].stat().st_size<250000:
   raise RuntimeError("unexpected_dex_artifact_count")
  primary=outputs[0].read_bytes()
  unsigned=p/"unsigned.apk"
  with zipfile.ZipFile(BASE) as original,zipfile.ZipFile(unsigned,"w") as out:
   for member in original.infolist():
    if member.filename.startswith("META-INF/") and (
       member.filename=="MANIFEST.MF" or
       member.filename.endswith((".RSA",".SF",".DSA",".EC"))):continue
    data=primary if member.filename=="classes.dex" else original.read(member.filename)
    out.writestr(member,data)
  aligned=p/"aligned.apk";run(["zipalign","-f","4",str(unsigned),str(aligned)],80)
  signed=p/"signed.apk"
  run(["apksigner","sign","--ks",str(KEY/"key.jks"),"--ks-key-alias","s9security",
     "--ks-pass","file:"+str(KEY/"pass"),"--out",str(signed),str(aligned)],95)
  signcheck(signed)
  with zipfile.ZipFile(signed) as package:
   if any(sha(package.read(n))!=digest for n,digest in baseline.items()):
    raise RuntimeError("changed_model_manifest_or_native_lib")
   if sha(package.read("classes.dex"))==original_main:
    raise RuntimeError("camera_code_not_replaced")
   if not all(w.encode() in package.read("classes.dex") for w in
     ["high_resolution_isolated_person_head_roi_v2",
      "image_speed_body_heights_per_second"]):
    raise RuntimeError("new_camera_evidence_unavailable")
  TARGET.mkdir(parents=True,exist_ok=True,mode=0o700)
  dest=TARGET/"s9-face-roi-movement-v1.apk"
  if dest.is_file() and sha(dest.read_bytes())!=sha(signed.read_bytes()):
   raise RuntimeError("unexpected_existing_signed_release")
  if not dest.exists():shutil.copy2(signed,dest)
  result={"signed":True,"installed":False,"apk":str(dest),
     "sha256":sha(dest.read_bytes()),"bytes":dest.stat().st_size,
     "compiled_java_sources":len(JAVAS),"source_sha":REF,
     "signer":FINGERPRINT,"models_native_and_manifest_preserved":True,
     "unsafe_in_app_merger_included":False,
     "face_roi":"high_resolution_isolated_person_head_roi_v2",
     "motion":"clip_scoped_2d_speed_and_straightness_no_pose_or_gait"}
  (TARGET/"release.json").write_text(json.dumps(result,indent=2)+"\n")
  print("S9_FACE_ROI_MOTION_V1_SIGNED_STAGED",json.dumps(result),flush=True)
if __name__=="__main__":main()
