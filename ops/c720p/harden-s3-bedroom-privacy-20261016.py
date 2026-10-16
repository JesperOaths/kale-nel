#!/usr/bin/env python3
"""Close S3 remote ADB port 5555 and disable unused IP webcam applications.

This is a deliberately one-way privacy change: Wi-Fi ADB management is lost
until S3 is connected by USB or the user explicitly re-enables it locally.
The on-phone S3 motion application and HA webhook remain untouched.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import socket
import subprocess
import time

S3="192.168.178.47"
ADB=S3+":5555"
MOTION="nl.kalenel.s3motion"
LEGACY=("com.pas.webcam.pro","com.github.digitallyrefined.androidipcamera")
ROOT=Path("/home/jespern/c720p-home-hub/state")
HA=Path("/opt/homeassistant/config/www/s3-motion-health.json")
TIMER="c720p-s3-motion-health.timer"

def run(args,timeout=24):
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
  return p.returncode,p.stdout.strip()[:1400],p.stderr.strip()[:240]
 except Exception as e:return 99,"",type(e).__name__

def adb(*args,timeout=24):
 return run(["adb","-s",ADB,*args],timeout=timeout)

def port_open():
 try:
  with socket.create_connection((S3,5555),timeout=2):
   return True
 except OSError:return False

def camera():
 try:
  p=subprocess.run(["adb","-s",ADB,"shell","dumpsys","media.camera"],
    capture_output=True,text=True,timeout=18)
  if p.returncode:return False
  return "Client Package Name: "+MOTION in p.stdout.split("Prior client events",1)[0]
 except Exception:return False

def frames():
 rc,_,_=adb("get-state",timeout=9)
 if rc:return None
 # Logcat may be long; take tail and extract the latest S3 heartbeat counter.
 p=subprocess.run(["adb","-s",ADB,"logcat","-d","-s","S3MOTION:I","*:S"],
   capture_output=True,text=True,timeout=20)
 if p.returncode:return None
 pairs=re.findall(r"HEARTBEAT session=([0-9]+)[^\n]*?frames=([0-9]+)",p.stdout)
 return (pairs[-1][0],int(pairs[-1][1])) if pairs else None

def state_write(locked,disabled):
 r={"sensor":"Galaxy S3 rear camera bedroom motion","privacy_lock":locked,
    "remote_diagnostics":"disabled_by_design" if locked else "available",
    "camera_active":None,"motion_analysis_active":None,
    "health_not_measured":True,
    "wifi_adb_listening":not locked,
    "disabled_legacy_camera_packages":disabled,
    "checked_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "warnings":["live_camera_status_unverifiable_without_ADB"] if locked else [],
    "images_or_audio_copied":False}
 for p in [ROOT/"s3-motion-health.json",HA]:
  p.parent.mkdir(parents=True,exist_ok=True)
  if p.is_symlink():raise RuntimeError("status_output_symlink")
  q=p.with_suffix(p.suffix+".tmp")
  q.write_text(json.dumps(r,indent=2)+"\n")
  q.replace(p)

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--apply",action="store_true")
 a=parser.parse_args()
 report={"mode":"apply" if a.apply else "read_only",
         "port":5555,"camera_stream_server_exposed":None,
         "irreversible_without_physical_recovery":True,
         "legitimate_camera_package_preserved":True,"camera_frames_copied":False,
         "disabled_packages":[]}
 if not port_open():
  report["status"]="adb_port_already_closed"
  print("S3_PRIVACY_PORT_LOCK "+json.dumps(report),flush=True);return
 if not camera():raise RuntimeError("S3_camera_not_active_preflight")
 before=frames()
 if before is None:raise RuntimeError("S3_heartbeat_unavailable")
 if a.apply:
  time.sleep(12)
  after=frames()
  if after is None or after[0]!=before[0] or after[1]<=before[1]+7:
   raise RuntimeError("S3_motion_frames_not_advancing")
 else:
  report["status"]="ready"
  print("S3_PRIVACY_PORT_LOCK "+json.dumps(report),flush=True)
  return
 # Disable abandoned webcam servers only; keep Android camera capability,
 # current motion application and its permissions fully unchanged.
 for app in LEGACY:
  rc,result,error=adb("shell","pm","disable-user","--user","0",app,timeout=24)
  report["disabled_packages"].append({"package":app,"success":rc==0})
 # Verify motion is continuing before turning off the remote admin listener.
 if not camera():raise RuntimeError("motion_camera_lost_after_disabling_old_apps")
 start=frames()
 time.sleep(12)
 later=frames()
 if start is None or later is None or start[0]!=later[0] or later[1]<=start[1]+7:
  raise RuntimeError("S3_motion_stopped_before_ADB_closure")
 # ADB 'usb' switches the Android debugger away from network transport. This
 # might terminate the TCP session in-flight; verify the resulting port state.
 command=run(["adb","-s",ADB,"usb"],timeout=30)
 report["adb_usb_command_rc"]=command[0]
 closed=False
 for _ in range(5):
  time.sleep(3)
  if not port_open():
   closed=True
   break
 report["adb_port_closed_verified"]=closed
 if not closed:
  raise RuntimeError("S3_ADB_TCP_5555_STILL_ACCESSIBLE")
 # Stop the old ADB-dependent diagnostic poll; it would otherwise show a
 # false failure every five minutes. Motion triggers remain on S3->HA webhook.
 pause=run(["systemctl","--user","disable","--now",TIMER],timeout=28)
 report["health_poll_disabled"]=pause[0]==0
 state_write(True,[x["package"] for x in report["disabled_packages"] if x["success"]])
 report["status"]="S3_ADB_WI_FI_CLOSED_CAMERA_LOCAL_ONLY"
 print("S3_PRIVACY_PORT_LOCK "+json.dumps(report,sort_keys=True),flush=True)

if __name__=="__main__":main()
