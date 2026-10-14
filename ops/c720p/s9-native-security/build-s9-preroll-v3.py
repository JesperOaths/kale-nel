#!/usr/bin/env python3
"""Build signed S9 face-ROI + measured image movement release, without FFmpegKit.

Immutably fetch the audited 19-source Android revision and compile. Repackage
only primary classes.dex of the already signed/pinned S9 APK; preserve asset
model bytes, native shared libraries, manifest and secondary runtime dex. Do
NOT install or launch anything; installation requires separate guarded gate.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,tempfile,urllib.request,zipfile
HOME=Path("/home/jespern/c720p-home-hub")
REF=os.environ.get("S9_PREROLL_V3_REF","")
BASE=HOME/"build/s9-face-roi-movement-v2/s9-face-roi-movement-v2.apk"
TARGET=HOME/"build/s9-preroll-v3"
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
 if not re.fullmatch(r"[0-9a-f]{40}",REF):
  raise RuntimeError("S9_FACE_ROI_V2_REF_must_be_immutable_40_character_SHA")
 # Heavy javac/d8 and APK-repack intermediates live in RAM-backed /tmp.
 # Keep enough *persistent* disk for the signed APK and rollback; do not
 # require 1.3GiB on the root volume when /tmp is an independent tmpfs.
 free=os.statvfs(HOME)
 scratch=os.statvfs("/tmp")
 if free.f_bavail*free.f_frsize<380*1024**2:
  raise RuntimeError("hub_disk_below_380MiB_refuse_build")
 if scratch.f_bavail*scratch.f_frsize<650*1024**2:
  raise RuntimeError("tmpfs_below_650MiB_refuse_build")
 if not BASE.is_file():raise RuntimeError("baseline_signed_apk_missing")
 signcheck(BASE)
 baseline_sha=sha(BASE.read_bytes())
 if baseline_sha!="881069d0c91616761a5e8cd4e321738e469cf1bd5e64432c1c7a6578db24e4c4":
  raise RuntimeError("installed_v2_baseline_unexpected")
 with zipfile.ZipFile(BASE) as apk:
  baseline={n:sha(apk.read(n)) for n in apk.namelist()
   if n=="AndroidManifest.xml" or n.startswith("assets/") or
   n.startswith("lib/")}
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
  assert "s9_on_phone_avc_memory_ring_keyframe_7s_v3" in (src/"GardenPreRoll.java").read_text()
  assert "MIN_US=5500000L" in (src/"GardenPreRoll.java").read_text()
  assert "high_resolution_isolated_person_head_roi_v2" in (src/"S9FaceReview.java").read_text()
  assert "imageSpeedBodyHeightsPerSecond" in (src/"AnonymousClipTracks.java").read_text()
  assert "s9_onphone_36_samples_person_roi_v2" in (src/"ClipClassifier.java").read_text()
  assert "faceBackfillRetries" in (src/"CameraService.java").read_text()
  assert "face_detector_raw_hits" in (src/"S9FaceReview.java").read_text()
  classes=p/"classes";classes.mkdir()
  run(["javac","-source","8","-target","8","-cp",":".join(map(str,[android,*cp])),
    "-d",str(classes),*map(str,src.glob("*.java"))],180)
  if not (classes/"nl/kalenel/s9security/GardenPreRoll.class").is_file():raise RuntimeError("preroll_class_missing")
  if not (classes/"nl/kalenel/s9security/S9FaceReview.class").is_file():
   raise RuntimeError("compiled_face_class_missing")
  dex=p/"dex";dex.mkdir()
  run(["d8","--min-api","26","--lib",str(android),"--output",str(dex),
      *map(str,classes.rglob("*.class")),*map(str,cp)],240)
  outputs=sorted(dex.glob("classes*.dex"))
  print("DEX_OUTPUTS",[(a.name,a.stat().st_size) for a in outputs],flush=True)
  if not 1<=len(outputs)<=4 or outputs[0].stat().st_size<10000:
   raise RuntimeError("unexpected_dex_artifact_count")
  primary=outputs[0].read_bytes()
  unsigned=p/"unsigned.apk"
  with zipfile.ZipFile(BASE) as original,zipfile.ZipFile(unsigned,"w") as out:
   for member in original.infolist():
    if member.filename.startswith("META-INF/") and (
       member.filename=="MANIFEST.MF" or
       member.filename.endswith((".RSA",".SF",".DSA",".EC"))):continue
    # The release omits ALL legacy FFmpegKit Java and smart-exception classes,
    # including any old secondary dex. Replace dex set atomically.
    if member.filename.startswith("classes") and member.filename.endswith(".dex"):continue
    out.writestr(member,original.read(member.filename))
   for release_dex in outputs:
    out.writestr(release_dex.name,release_dex.read_bytes())
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
      "image_speed_body_heights_per_second",
      "s9_onphone_36_samples_person_roi_v2", "face_evidence_outcome"]):
    raise RuntimeError("new_camera_evidence_unavailable")
  if not any(b"s9_on_phone_avc_memory_ring_keyframe_7s_v3" in d.read_bytes() for d in outputs):
   raise RuntimeError("preroll_v3_dex_marker_missing")
  TARGET.mkdir(parents=True,exist_ok=True,mode=0o700)
  dest=TARGET/"s9-preroll-v3.apk"
  if dest.is_file() and sha(dest.read_bytes())!=sha(signed.read_bytes()):
   raise RuntimeError("unexpected_existing_signed_release")
  if not dest.exists():shutil.copy2(signed,dest)
  result={"signed":True,"installed":False,"apk":str(dest),
     "sha256":sha(dest.read_bytes()),"bytes":dest.stat().st_size,
     "compiled_java_sources":len(JAVAS),"dex_files":len(outputs),"source_sha":REF,
     "signer":FINGERPRINT,"models_native_and_manifest_preserved":True,
     "unsafe_in_app_merger_included":False,
     "face_roi":"high_resolution_isolated_person_head_roi_v2",
     "motion":"clip_scoped_2d_speed_and_straightness_no_pose_or_gait",
     "historical_face_review":"bounded_verified_4k_roi_v2",
     "source_ref_immutable":True,"preroll_version":"s9_on_phone_avc_memory_ring_keyframe_7s_v3","min_saved_preroll_ms":5500,"baseline_apk_sha256":baseline_sha}
  (TARGET/"release.json").write_text(json.dumps(result,indent=2)+"\n")
  print("S9_PREROLL_V3_SIGNED_STAGED",json.dumps(result),flush=True)
if __name__=="__main__":main()
