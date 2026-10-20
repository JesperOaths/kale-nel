#!/usr/bin/env python3
"""Task14 nonmutating physical provenance: never reinstall/restart Camera2.

Checks actual installed C720P rollout producer and terminal state, S9 native
capture and package digest without changing installed code or clock.
Only aggregated provenance and hashes leave C720P, no MP4/person IDs.
"""
import argparse
import hashlib
import json
import re
import stat
import subprocess
from pathlib import Path
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
PRODUCER=HOME/"bin/s9_7s_cool_rollout_v1.py"
RESULT=HOME/"state/s9-native-seven-second-rollout-v1.json"
CAMERA="http://127.0.0.1:18808/status"
NEW_SHA="37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"
OLD_SCHEMA="s9_native_7s_cool_rollout_v1"
MARK="S9_ROLLOUT_SUCCESS_SCHEMA_TASK14_PHYSICAL "

def read(path,bound,private=False):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("required_rollout_file_absent")
 st=path.stat()
 if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1
     or not 10<st.st_size<bound
     or (st.st_mode&(0o077 if private else 0o022))):
  raise RuntimeError("rollout_file_untrusted")
 raw=path.read_bytes()
 if len(raw)!=st.st_size or st.st_mtime_ns!=path.stat().st_mtime_ns:
  raise RuntimeError("rollout_file_changed_while_reading")
 return raw

def native():
 with urllib.request.urlopen(CAMERA,timeout=9) as r:
  if r.status!=200:raise RuntimeError("camera_status_unavailable")
  content=r.read(65537)
 if len(content)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(content)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<39.5):
  raise RuntimeError("camera_not_safe_or_healthy")
 return d

def phone_apk_sha():
 # Non-invasive ADB shell package read only; NO pm install, force-stop,
 # reboot, key modification or media reads.
 device="192.168.178.250:5555"
 cmd=["adb","-s",device,"shell","pm","path","nl.kalenel.s9security"]
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=24)
 if p.returncode:raise RuntimeError("native_apk_probe_unavailable")
 paths=[line.removeprefix("package:").strip() for line in p.stdout.splitlines()
        if line.startswith("package:") and line.endswith("/base.apk")]
 if len(paths)!=1 or not paths[0].startswith("/data/app/"):
  raise RuntimeError("native_apk_path_untrusted")
 p=subprocess.run(["adb","-s",device,"shell","sha256sum",paths[0]],
                  capture_output=True,text=True,timeout=30)
 if p.returncode:raise RuntimeError("native_apk_sha_unavailable")
 digest=p.stdout.split()[0] if p.stdout.split() else ""
 if not re.fullmatch("[0-9a-f]{64}",digest):
  raise RuntimeError("native_apk_sha_malformed")
 return digest

def inspect(expected):
 if not re.fullmatch("[0-9a-f]{64}",expected):
  raise RuntimeError("expected_producer_sha_invalid")
 before=native()
 raw=read(PRODUCER,150000)
 doc=json.loads(read(RESULT,150000,private=True))
 after=native()
 package_sha=phone_apk_sha()
 if (doc.get("schema_version")!=OLD_SCHEMA or
     doc.get("candidate_sha256")!=NEW_SHA):
  raise RuntimeError("rollout_terminal_provenance_invalid")
 installed=doc.get("installed") is True
 state=doc.get("state")
 current_sha=hashlib.sha256(raw).hexdigest()
 if (state!="done" or package_sha!=NEW_SHA):
  raise RuntimeError("installed_camera_or_rollout_state_not_verified")
 return {"installed_source_matches_current_main":current_sha==expected,
    "installed_source_sha256":current_sha,
    "expected_source_sha256":expected,
    "rollout_done":True,"rollout_installed_field_true":installed,
    "rollout_already_installed":doc.get("already_installed") is True,
    "phone_apk_matches_exact_candidate":True,
    "schema_version_verified":True,
    "camera_ready_before_after":True,
    "camera_dropped_frames_after":after["continuous_4k_dropped_output_frames"],
    "camera_temperature_after_c":after["temperature_c"],
    "no_camera_reinstall_or_restart":True,"original_videos_or_manual_reviews_modified":False,
    "producer_updated_by_this_probe":False,"terminal_result_updated_by_this_probe":False}

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--run",action="store_true")
 p.add_argument("--expected-producer-sha256")
 a=p.parse_args()
 if not a.run:
  print("S9_ROLLOUT_SUCCESS_TASK14_PREVIEW "+json.dumps({
   "read_only":True,"apk_install":False,"camera_restart":False},sort_keys=True))
 else:
  try:
   result=inspect(a.expected_producer_sha256)
   print(MARK+json.dumps(result,sort_keys=True),flush=True)
  except Exception as e:
   allowed={"required_rollout_file_absent","rollout_file_untrusted",
    "rollout_file_changed_while_reading","camera_status_unavailable",
    "camera_status_unbounded","camera_not_safe_or_healthy",
    "native_apk_probe_unavailable","native_apk_path_untrusted",
    "native_apk_sha_unavailable","native_apk_sha_malformed",
    "rollout_terminal_provenance_invalid",
    "installed_camera_or_rollout_state_not_verified",
    "expected_producer_sha_invalid"}
   reason=str(e)
   if reason not in allowed:reason="other_no_private_detail"
   print("S9_ROLLOUT_SUCCESS_TASK14_NOT_VERIFIED "+json.dumps({
    "reason_code":reason,"camera_restarted":False,
    "source_or_state_modified":False},sort_keys=True),flush=True)
   raise SystemExit(1)
