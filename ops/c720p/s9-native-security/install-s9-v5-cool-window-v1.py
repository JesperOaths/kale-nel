#!/usr/bin/env python3
"""Install/verify a C720P-local systemd timer; never restart the S9+ camera."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import tempfile
import urllib.request

HOME=Path("/home/jespern")
ROOT=HOME/"c720p-home-hub"
BIN=ROOT/"bin/s9-v5-cool-window-worker.py"
CONF=ROOT/"etc/s9-face-v5-cool-window-v1.json"
UNITS=HOME/".config/systemd/user"
SERVICE=UNITS/"c720p-s9-face-v5-cool-window.service"
TIMER=UNITS/"c720p-s9-face-v5-cool-window.timer"
GITHUB="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
WORKER="ops/c720p/s9-native-security/s9-v5-cool-window-worker.py"
UNIT="c720p-s9-face-v5-cool-window"

def run(*args):
 result=subprocess.run(args,capture_output=True,text=True,timeout=45)
 if result.returncode:raise RuntimeError("systemd_command_failed:"+result.stderr[-300:])
 return result.stdout.strip()

def digest(data):return hashlib.sha256(data).hexdigest()

def stage_atomic(path,data,permissions):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.is_symlink():raise RuntimeError("refuse_symlink_destination")
 with tempfile.NamedTemporaryFile(dir=str(path.parent),prefix=".s9v5-install-",
                                  delete=False) as tmp:
  tmp.write(data);tmp.flush();os.fsync(tmp.fileno())
  name=tmp.name
 os.chmod(name,permissions)
 os.replace(name,path)

def main():
 a=argparse.ArgumentParser()
 for field in ("ref","worker_sha","build_sha","installer_sha"):
  a.add_argument("--"+field.replace("_","-"),required=True)
 args=a.parse_args()
 if pwd.getpwuid(os.getuid()).pw_name!="jespern":
  raise RuntimeError("run_as_c720p_user_not_root")
 if not re.fullmatch(r"[a-f0-9]{40}",args.ref) or not all(
   re.fullmatch(r"[a-f0-9]{64}",d) for d in (
   args.worker_sha,args.build_sha,args.installer_sha)):
  raise RuntimeError("immutable_source_or_digest_invalid")
 with urllib.request.urlopen(GITHUB+args.ref+"/"+WORKER,timeout=45) as response:
  raw=response.read(100001)
 if not 1000<len(raw)<100000 or digest(raw)!=args.worker_sha:
  raise RuntimeError("worker_file_sha_mismatch")
 import ast
 ast.parse(raw.decode("utf-8"),filename=WORKER)
 config={"ref":args.ref,"build_sha256":args.build_sha,
         "install_sha256":args.installer_sha}
 program=(BIN.read_bytes() if BIN.exists() else None)
 previous={p:(p.read_bytes() if p.exists() else None) for p in (BIN,CONF,SERVICE,TIMER)}
 service=("[Unit]\nDescription=S9 V5 4K face archive guarded deployment window\n"
          "After=network-online.target\n"
          "[Service]\nType=oneshot\n"
          "ExecStart=/usr/bin/python3 "+str(BIN)+"\n"
          "TimeoutStartSec=1200\n"
          "Nice=12\nIOSchedulingClass=idle\n"
          "NoNewPrivileges=yes\n").encode()
 timer=("[Unit]\nDescription=Check S9+ thermal/idle window for V5 archive review\n"
        "[Timer]\nOnCalendar=*:0/5\n"
        "AccuracySec=1min\nRandomizedDelaySec=2min\n"
        "Persistent=true\nUnit="+UNIT+".service\n"
        "[Install]\nWantedBy=timers.target\n").encode()
 try:
  stage_atomic(BIN,raw,0o700)
  stage_atomic(CONF,(json.dumps(config,sort_keys=True)+"\n").encode(),0o600)
  stage_atomic(SERVICE,service,0o644)
  stage_atomic(TIMER,timer,0o644)
  run("systemctl","--user","daemon-reload")
  run("systemctl","--user","enable","--now",UNIT+".timer")
  # Re-arm the TIMER unit itself: enable --now does not re-schedule an
  # already-active timer stuck in SubState=elapsed. Never restart the
  # Camera2 phone app or the service from this bootstrap.
  run("systemctl","--user","restart",UNIT+".timer")
  enabled=run("systemctl","--user","is-enabled",UNIT+".timer")
  active=run("systemctl","--user","is-active",UNIT+".timer")
  if enabled!="enabled" or active!="active":
   raise RuntimeError("systemd_timer_not_persistently_enabled")
  metadata=run("systemctl","--user","show",UNIT+".timer",
               "--property=SubState,NextElapseUSecRealtime","--no-pager")
  values=dict(line.split("=",1) for line in metadata.splitlines() if "=" in line)
  if values.get("SubState")!="waiting" or not values.get("NextElapseUSecRealtime"):
   raise RuntimeError("calendar_timer_not_rearmed_with_future_deadline")
 except Exception:
  for target,old in previous.items():
   if old is None:
    if target.exists():target.unlink()
   else:
    stage_atomic(target,old,0o600 if target==CONF else 0o700 if target==BIN else 0o644)
  try:run("systemctl","--user","daemon-reload")
  except Exception:pass
  raise
 print("S9_V5_LOCAL_TIMER_VERIFIED "+json.dumps({
    "installed":True,"ref":args.ref,"worker_sha256":digest(raw),
    "timer_active":True,"timer_enabled":True,
    "run_on":"C720P_user_systemd","camera_apk_changed":False,
    "recordings_modified":False,"initial_scan_started":False,
    "check_interval_minutes":5,"timer_substate":values["SubState"],
    "has_next_calendar_deadline":True},sort_keys=True),flush=True)

if __name__=="__main__":main()
