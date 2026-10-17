#!/usr/bin/env python3
"""C720P-only, checksum-pinned historical GPU relay update. Never touches Camera2."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub")
TARGET=ROOT/"bin/s9-historical-gpu-relay.py"
BACKUPS=ROOT/"backups/s9-history-relay-42c"
SOURCE="ops/c720p/s9-native-security/s9-historical-gpu-relay.py"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/{ref}/"+SOURCE

def sha(content): return hashlib.sha256(content).hexdigest()
def atomic(target,raw,mode=0o600):
 target.parent.mkdir(parents=True,exist_ok=True)
 if target.is_symlink():raise RuntimeError("symlink_destination_refused")
 with tempfile.NamedTemporaryFile(mode="wb",dir=str(target.parent),
                                  prefix=".s9-history-42c-",delete=False) as f:
  f.write(raw);f.flush();os.fsync(f.fileno());tmp=f.name
 os.chmod(tmp,mode)
 os.replace(tmp,target)
 if sha(target.read_bytes())!=sha(raw):raise RuntimeError("atomic_readback_mismatch")

def main():
 args=argparse.ArgumentParser()
 args.add_argument("--ref",required=True)
 args.add_argument("--sha256",required=True)
 p=args.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",p.ref) or not re.fullmatch(r"[a-f0-9]{64}",p.sha256):
  raise ValueError("pinned_source_required")
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("live_relay_target_missing")
 before=TARGET.read_bytes()
 backup_path=None
 with urllib.request.urlopen(URL.format(ref=p.ref),timeout=40) as response:
  new=response.read(150001)
 if len(new)>150000 or len(new)<2500 or sha(new)!=p.sha256:
  raise RuntimeError("historical_42c_source_checksum_failure")
 compile(new.decode("utf-8"),str(TARGET),"exec")
 for mark in (b"if temperature>=42:",b"phone_inference_limit=42.0",
              b"application_battery_temperature_max_c",b"phone_4k_not_ready_for_staging"):
  if mark not in new:raise RuntimeError("expected_42c_guard_missing")
 old_sha=sha(before)
 if old_sha!=p.sha256:
  BACKUPS.mkdir(parents=True,exist_ok=True)
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  backup_path=BACKUPS/(stamp+"-s9-historical-gpu-relay.py")
  atomic(backup_path,before)
  try:atomic(TARGET,new,0o644)
  except Exception:
   atomic(TARGET,before,0o644)
   raise
 if sha(TARGET.read_bytes())!=p.sha256:raise RuntimeError("relay_readback_checksum_invalid")
 # A one-shot timer loads the Python source afresh on its next invocation.
 # Do not interrupt a running historical review, GPU work or 4K camera.
 timer=subprocess.run(["systemctl","--user","is-active","c720p-s9-historical-v28.timer"],
   capture_output=True,text=True,timeout=15)
 if timer.returncode!=0 or timer.stdout.strip()!="active":
  raise RuntimeError("historical_v28_timer_not_active")
 print("S9_HISTORY_42C_RELAY_VERIFIED "+json.dumps({
   "source_ref":p.ref,"source_sha256":p.sha256,
   "already_installed":old_sha==p.sha256,
   "rollback_copy":str(backup_path) if backup_path else None,
   "timer_active":True,"camera_apk_changed":False,
   "camera_service_restarted":False,"original_videos_modified":False,
   "no_identity_inference_exported":True
 },sort_keys=True),flush=True)

if __name__=="__main__":main()
