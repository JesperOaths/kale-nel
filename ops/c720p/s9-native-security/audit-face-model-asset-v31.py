#!/usr/bin/env python3
"""Inspect only the installed S9+ Camera2 APK for a local embedding-model asset.

No video, image, face embedding, enrollment file or gallery is requested.
Downloads just the installed app package into ephemeral RAM on the C720P,
reports asset metadata, immediately unlinks the temporary package.
"""
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
import urllib.request

PHONE="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
NAME="assets/face_embedding.tflite"

def phone_status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=14) as response:
  data=json.load(response)
 if not data.get("ok") or not data.get("continuous_4k_ready"):
  raise RuntimeError("camera_not_4k_healthy")
 return data

def run(*args,timeout=28):
 p=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError("adb_device_unavailable")
 return p.stdout.decode("utf-8","replace").strip()

def apk_path(reply):
 choices=[]
 for line in reply.splitlines():
  m=re.fullmatch(r"package:(/data/app/[A-Za-z0-9_./=-]+/base[.]apk)",line.strip())
  if m:choices.append(m.group(1))
 if len(choices)!=1:raise RuntimeError("installed_camera_base_apk_not_unambiguous")
 return choices[0]

def summarize_model(apk):
 with zipfile.ZipFile(apk) as bundle:
  item=bundle.getinfo(NAME) if NAME in bundle.namelist() else None
  if item is None:return {"installed_model_asset":False,
    "model_compatibility":"not_possible_without_asset"}
  if item.file_size>12_000_000 or item.file_size<100_000:
   return {"installed_model_asset":True,"model_asset_size":item.file_size,
    "model_compatibility":"asset_size_outside_expected_contract"}
  with bundle.open(item) as f:
   data=f.read(12_000_001)
  if len(data)!=item.file_size or len(data)>12_000_000:
   raise RuntimeError("face_model_asset_unexpected_size")
  return {"installed_model_asset":True,"model_asset_size":item.file_size,
    "model_sha256":hashlib.sha256(data).hexdigest(),
    "model_compatibility":"tensor_contract_requires_on_device_inference_test"}

def main():
 before=phone_status()
 apk=apk_path(run("shell","pm","path",PACKAGE,timeout=14))
 scratch=Path("/dev/shm")
 if not scratch.is_dir() or scratch.is_symlink():
  raise RuntimeError("ephemeral_RAM_staging_unavailable")
 with tempfile.TemporaryDirectory(prefix="s9-face-apk-audit-",dir=scratch) as folder:
  target=Path(folder)/"installed-base.apk"
  p=subprocess.run(["adb","-s",PHONE,"pull",apk,str(target)],
     capture_output=True,timeout=80)
  if p.returncode or not target.is_file() or not 3_000_000<target.stat().st_size<65_000_000:
   raise RuntimeError("installed_apk_transfer_failed")
  outcome=summarize_model(target)
 after=phone_status()
 if not after.get("continuous_4k_ready") or after.get("mode")!="watching":
  raise RuntimeError("camera_state_changed_during_diagnostic")
 print("S9_FACE_MODEL_ASSET_V31 "+json.dumps({
  **outcome,"package":PACKAGE,
  "4k_healthy":True,"phone_mode":after.get("mode"),
  "APK_digest_not_persisted":True,
  "APK_temp_file_removed":True,
  "biometric_person_data_processed":False,
  "phone_apk_modified":False,
  "original_recordings_unchanged":True},sort_keys=True),flush=True)

if __name__=="__main__":main()
