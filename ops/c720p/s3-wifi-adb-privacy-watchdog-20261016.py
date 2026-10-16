#!/usr/bin/env python3
"""C720P local S3 bedroom privacy safeguard.

Every 30 minutes check only if TCP/5555 reopened; if so, use the previously
authorized ADB link to switch S3 back to USB-only debugging. Never open or
transport a camera frame, and never wake or stop the motion application.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import socket
import subprocess
import time

HOME=Path("/home/jespern")
BIN=HOME/"c720p-home-hub/bin"
UNIT_ROOT=HOME/".config/systemd/user"
ROOT=HOME/"c720p-home-hub/state"
DEST=BIN/"c720p-s3-privacy-watchdog.py"
SERVICE=UNIT_ROOT/"c720p-s3-privacy-watchdog.service"
TIMER=UNIT_ROOT/"c720p-s3-privacy-watchdog.timer"
S3="192.168.178.47"
SERIAL=S3+":5555"
SERVICE_TEXT="""[Unit]
Description=Close accidentally reopened S3 bedroom Wi-Fi ADB port
After=default.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-s3-privacy-watchdog.py --check
Nice=18
IOSchedulingClass=idle
TimeoutStartSec=75
"""
TIMER_TEXT="""[Unit]
Description=Check S3 bedroom ADB network exposure every 30 minutes
[Timer]
OnBootSec=3min
OnUnitInactiveSec=30min
AccuracySec=2min
Unit=c720p-s3-privacy-watchdog.service
[Install]
WantedBy=timers.target
"""

def command(args,timeout=20):
 try:
  p=subprocess.run(args,timeout=timeout,capture_output=True,text=True)
  return p.returncode,p.stdout.strip()[:300]
 except Exception as e:return 99,type(e).__name__

def exposed():
 try:
  with socket.create_connection((S3,5555),timeout=2.0):
   return True
 except OSError:return False

def record(report):
 ROOT.mkdir(parents=True,exist_ok=True)
 target=ROOT/"s3-privacy-watchdog.json"
 if target.is_symlink():return
 staging=ROOT/"s3-privacy-watchdog.json.tmp"
 staging.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
 staging.replace(target)

def check():
 report={"checked_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
         "port":5555,"images_accessed":False}
 if not exposed():
  report["result"]="adb_port_not_listening"
  record(report)
  print("S3_ADB_PRIVACY_WATCH "+json.dumps(report,sort_keys=True),flush=True)
  return
 report["port_reopened"]=True
 rc,state=command(["adb","-s",SERIAL,"get-state"],timeout=12)
 report["authorized_adb_connected"]=rc==0 and state=="device"
 if rc==0 and state=="device":
  code,_=command(["adb","-s",SERIAL,"usb"],timeout=24)
  report["close_command_rc"]=code
  for _ in range(4):
   time.sleep(4)
   if not exposed():break
  report["port_closed_after_repair"]=not exposed()
 else:
  report["port_closed_after_repair"]=False
 report["result"]="restored_private_adb" if report["port_closed_after_repair"] else "exposure_unresolved"
 record(report)
 print("S3_ADB_PRIVACY_WATCH "+json.dumps(report,sort_keys=True),flush=True)
 if report["result"]=="exposure_unresolved":
  raise RuntimeError("S3_WI_FI_ADB_EXPOSURE_PERSISTS")

def atomic_write(path,data):
 if path.is_symlink():raise RuntimeError("symlinked_install_target")
 temp=path.with_name(path.name+".tmp-"+str(os.getpid()))
 try:
  temp.write_bytes(data)
  os.replace(temp,path)
 finally:
  if temp.exists():temp.unlink()

def install():
 for p in (BIN,UNIT_ROOT):
  if p.is_symlink():raise RuntimeError("symlinked_install_dir")
  p.mkdir(parents=True,exist_ok=True)
 atomic_write(DEST,Path(__file__).read_bytes())
 atomic_write(SERVICE,SERVICE_TEXT.encode())
 atomic_write(TIMER,TIMER_TEXT.encode())
 if command(["systemctl","--user","daemon-reload"])[0]!=0:
  raise RuntimeError("systemd_reload_failed")
 if command(["systemctl","--user","enable","--now",TIMER.name])[0]!=0:
  raise RuntimeError("systemd_timer_enable_failed")
 code,status=command(["systemctl","--user","is-active",TIMER.name])
 if code!=0 or status!="active":raise RuntimeError("timer_not_active")
 print("S3_ADB_PRIVACY_WATCH "+json.dumps({"result":"installed",
    "timer_active":True,"period_minutes":30}),flush=True)
 check()

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--install",action="store_true")
 p.add_argument("--check",action="store_true")
 a=p.parse_args()
 if a.install:install()
 elif a.check:check()
 else:p.print_help()
