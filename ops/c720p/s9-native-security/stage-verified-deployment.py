#!/usr/bin/env python3
"""Stage and verify one immutable S9+ Camera2 release. NEVER deploys.

Runs only on the C720P. Downloads files from the exact commit already
compiled, signed, and recorded beside the APK. Copies trusted Java sources
from that immutable local build and checks them against the remote revision.
Tests control authorization, review matching, original SD/video integration
contracts and both HA UI patchers without modifying any production files.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
BUILD=BASE/"build/s9-native-security"
STAGE_PARENT=BASE/"build/s9-controls-validated"
GITHUB="https://raw.githubusercontent.com/JesperOaths/kale-nel"
NATIVE=[
 "test-native-camera-controls.py",
 "test-appearance-review.py",
 "test-drive-person-batch-catalog.py",
 "test-drive-visitor-review.py",
 "s9_appearance_review.py",
 "drive-person-batch-catalog.py",
 "legacy-drive-person-corpus.py",
 "deploy-drive-person-catalog.py",
 "deploy-camera-controls-and-appearance-review.py",
 "patch-native-camera-controls-ui.py",
 "patch-drive-visitor-review-ui.py",
 "c720p-s9-drive-person-catalog.service",
 "c720p-s9-drive-person-catalog.timer",
 "patch-anonymous-tracks-ui.py",
 "test-anonymous-index-ui.py",
 "deploy-anonymous-clips-index.py",
 "deploy-s9-frame-metrics.py",
 "patch-s9-face-review-ui.py",
 "test-s9-face-review.py",
]
PROXY=[
 "s9_native_camera_controls.py",
 "s9_sd_proxy_extension.py",
 "s9_drive_visitor_review.py",
 "local-sd-catalog.py",
 "s9_human_thumbnail_review.py",
 "s9_phone_garden_status.py",
]
ANDROID=["CameraService.java","CameraControls.java","MotionGrid.java","ClipClassifier.java","OutfitEvidence.java","AnonymousClipTracks.java","CameraOrientation.java","HistoricalImportWorker.java","S9FaceReview.java"]
TESTS=["test-native-camera-controls.py","test-drive-person-batch-catalog.py",
       "test-drive-visitor-review.py","test-appearance-review.py",
       "test-anonymous-index-ui.py","test-s9-face-review.py"]
SAFE_SHA=re.compile(r"[a-f0-9]{40}\Z")

def revision(build=BUILD):
 stamps=[build/".source-commit",build/".compiled-commit",
         build/"s9-native-security.apk.source-commit"]
 if any(not s.is_file() for s in stamps):
  raise RuntimeError("missing_signed_source_revision_evidence")
 versions=[s.read_text().strip() for s in stamps]
 if len(set(versions))!=1 or not SAFE_SHA.fullmatch(versions[0]):
  raise RuntimeError("signed_apk_and_compiled_source_versions_differ")
 apk=build/"s9-native-security.apk"
 if not apk.is_file() or apk.stat().st_size<4_000_000:
  raise RuntimeError("signed_apk_not_present")
 return versions[0],apk

def fetch(ref,relative):
 if not SAFE_SHA.fullmatch(ref) or ".." in relative or relative.startswith("/"):
  raise RuntimeError("immutable_github_path_required")
 url=f"{GITHUB}/{ref}/ops/c720p/{relative}"
 req=urllib.request.Request(url,headers={"User-Agent":"S9-readonly-release-stage/1"})
 with urllib.request.urlopen(req,timeout=48) as response:
  body=response.read(1_200_001)
  if len(body)>1_200_000 or len(body)<30:
   raise RuntimeError("invalid_pinned_source_size")
  return body

def commit_to_stage(ref,base=STAGE_PARENT,build=BUILD):
 stage=base/ref
 native=stage/"s9-native-security"
 proxy=stage/"s9-person-ml-v1"
 java=native/"src/nl/kalenel/s9security"
 java.mkdir(parents=True,exist_ok=True)
 files=[]
 for name in NATIVE:
  files.append(("s9-native-security/"+name,native/name))
 for name in PROXY:
  files.append(("s9-person-ml-v1/"+name,proxy/name))
 for name in ANDROID:
  files.append(("s9-native-security/src/nl/kalenel/s9security/"+name,java/name))
 for relative,dst in files:
  body=fetch(ref,relative)
  if relative.endswith(".java"):
   local=build/"src/nl/kalenel/s9security"/dst.name
   if not local.is_file() or local.read_bytes()!=body:
    raise RuntimeError("downloaded_java_differs_from_locally_compiled_source_"+dst.name)
  if dst.exists():
   if dst.read_bytes()!=body:raise RuntimeError("immutable_stage_existing_file_mismatch_"+dst.name)
  else:
   dst.parent.mkdir(parents=True,exist_ok=True)
   tmp=dst.with_name(dst.name+".source-stage")
   with tmp.open("xb") as f:
    f.write(body);f.flush();os.fsync(f.fileno())
   os.replace(tmp,dst)
 return stage,len(files)

def check_tests(stage):
 native=stage/"s9-native-security"
 env={**os.environ,"PYTHONPATH":str(native)}
 venv=BASE/"build/s9-detector-benchmark/venv/bin/python"
 if not venv.is_file():raise RuntimeError("pinned_model_python_venv_missing")
 for test in TESTS:
  python=str(venv) if test=="test-appearance-review.py" else sys.executable
  subprocess.run([python,str(native/test)],capture_output=True,text=True,
     timeout=55,check=True,env=env)
 for source in list(native.glob("*.py"))+list((stage/"s9-person-ml-v1").glob("*.py")):
  subprocess.run([sys.executable,"-m","py_compile",str(source)],
     timeout=12,check=True,capture_output=True,text=True)

def check_ui(stage):
 patches=[
  ("s9-native-security/patch-native-camera-controls-ui.py",
   "/opt/homeassistant/config/www/c720p-surveillance.html",
   "S9_NATIVE_CAMERA2_SECURITY_CONTROLS_V1"),
  ("s9-native-security/patch-drive-visitor-review-ui.py",
   "/opt/homeassistant/config/www/frontyard-security-new/clips.html",
   "Possible repeat outfit"),
  ("s9-native-security/patch-anonymous-tracks-ui.py",
   "/opt/homeassistant/config/www/frontyard-security-new/clips.html",
   "s9-anonymous-clips-script-v1"),
  ("s9-native-security/patch-s9-face-review-ui.py",
   "/opt/homeassistant/config/www/frontyard-security-new/clips.html",
   "s9-face-review-script-v1")
 ]
 summary=[]
 for module,html,marker in patches:
  source=stage/module
  spec=importlib.util.spec_from_file_location(
   "s9_checked_"+source.stem.replace("-","_"),source)
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  raw=Path(html).read_text()
  method=m.patch_text if hasattr(m,"patch_text") else m.patch
  updated=method(raw)
  if method(updated)!=updated or marker not in updated:
   raise RuntimeError("security_ui_patch_not_idempotent_"+module)
  summary.append({"page":Path(html).name,"stage_ready":True,
                  "currently_updated":marker in raw})
 return summary

def stage_release():
 ref,apk=revision()
 subprocess.run(["apksigner","verify",str(apk)],capture_output=True,text=True,timeout=25,check=True)
 stage,count=commit_to_stage(ref)
 check_tests(stage)
 ui=check_ui(stage)
 output={
  "ok":True,
  "verification":"stage_only_no_install_no_systemd_changes",
  "source_compiled_signed_revision":ref,
  "apk_bytes":apk.stat().st_size,
  "immutable_source_files":count,
  "source_regression_tests":"passed",
  "security_ui_patches":ui,
  "staged_dir":str(stage),
  "installed_android_apk_changed":False,
  "video_or_drive_files_modified":False,
  "deployment_ready":True,
  "deployed":False,
 }
 print("S9_IMMUTABLE_CAMERA2_RELEASE_STAGE_PASS",json.dumps(output,sort_keys=True))
 return output

if __name__=="__main__":
 argparse.ArgumentParser(description=__doc__).parse_args()
 stage_release()
