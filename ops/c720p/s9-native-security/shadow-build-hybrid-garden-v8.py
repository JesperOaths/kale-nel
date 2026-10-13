#!/usr/bin/env python3
"""Read-only S9+ hybrid person detector v8 build + unit test; no APK installation.

Stage the pinned complete Android source tree away from the production build,
compile against the existing Android/TFLite SDK, then execute deterministic
tracking tests. Does not change phone, recordings, camera or baseline binaries.
"""
import argparse,datetime as dt,hashlib,json,os
from pathlib import Path
import re,subprocess,tempfile,urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
ORIGINAL=BASE/"build/s9-native-security"
DEPENDENCIES=BASE/"build/s9-person-ml-v1/deps"
JAVA=Path("src/nl/kalenel/s9security")
FILES=[
 "AnonymousClipTracks.java","Boot.java","CameraActivity.java","CameraControls.java",
 "CameraOrientation.java","CameraService.java","CaptureContinuity.java","ClipClassifier.java",
 "EventFrameRanker.java","GardenArchiveTriage.java","GardenPersonTrackGate.java",
 "GardenPreRoll.java","HistoricalImportWorker.java","MotionGrid.java","OutfitEvidence.java",
 "PhoneMediaRange.java","PreviewJpeg.java","RecordingRate.java","S9FaceReview.java"
]
REQUIRED=["CameraService.class","GardenPersonTrackGate.class","ClipClassifier.class"]
TESTS=["tests/GardenPersonTrackGateTest.java"]

def fetch(sha,relative):
 if not re.fullmatch("[a-f0-9]{40}",sha):raise RuntimeError("unpinned_commit")
 url=f"https://raw.githubusercontent.com/JesperOaths/kale-nel/{sha}/ops/c720p/s9-native-security/{relative}"
 with urllib.request.urlopen(url,timeout=45) as r:bytes_=r.read(200001)
 if not 100<len(bytes_)<200000:raise RuntimeError("bad_source_size:"+relative)
 return bytes_

def run(args,timeout=110):
 return subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=True)

def main():
 p=argparse.ArgumentParser();p.add_argument("--commit",required=True)
 args=p.parse_args()
 library=next(iter(sorted(Path("/usr/lib/android-sdk/platforms").glob("*/android.jar"))),None)
 if library is None:raise RuntimeError("Android_sdk_missing")
 jars=[DEPENDENCIES/(name+".jar") for name in (
  "tensorflow-lite","tensorflow-lite-api","tensorflow-lite-gpu","tensorflow-lite-gpu-api")]
 if any(not x.is_file() for x in jars):raise RuntimeError("TensorFlow_dependencies_missing")
 if not ORIGINAL.joinpath("s9-native-security.apk").is_file():raise RuntimeError("production_reference_unavailable")
 with tempfile.TemporaryDirectory(prefix="s9-detector-v8-source-") as directory:
  root=Path(directory);stage=root/JAVA;stage.mkdir(parents=True)
  for file in FILES:
   data=fetch(args.commit,(JAVA/file).as_posix())
   (stage/file).write_bytes(data)
  tests=root/"tests";tests.mkdir()
  for f in TESTS:(tests/Path(f).name).write_bytes(fetch(args.commit,f))
  # Source compile only: no production mutation and no APK app lifecycle.
  out=root/"classes";out.mkdir()
  cp=os.pathsep.join(str(x) for x in [library,*jars])
  cmd=["javac","-source","8","-target","8","-cp",cp,
       "-d",str(out),*map(str,stage.glob("*.java"))]
  built=run(cmd,110)
  for name in REQUIRED:
   if not (out/"nl/kalenel/s9security"/name).is_file():raise RuntimeError("missing_class_"+name)
  pure=run(["javac","-source","8","-target","8","-cp",str(out),
      "-d",str(out),str(tests/"GardenPersonTrackGateTest.java")],45)
  test=run(["java","-cp",str(out),"nl.kalenel.s9security.GardenPersonTrackGateTest"],35)
  if "S9_HYBRID_PERSON_GATE_V8_PASS" not in test.stdout:raise RuntimeError("gate_tests_failed")
  print("HYBRID_GARDEN_PERSON_V8_SHADOW_COMPILED",json.dumps({
   "source_sha":args.commit,"files":len(FILES),"compiled":len(list(out.rglob("*.class"))),
   "test_result":test.stdout.strip(),"changed_production_files":False,
   "camera_still_running":True,"apk_not_installed":True},sort_keys=True),flush=True)
if __name__=="__main__":main()
