#!/usr/bin/env python3
"""Guarded S9 C720P 360p FPS pilot. Changes only derived playback profile.
No original video / camera changes. Revert with --rollback if fps < 24.
"""
import json,os,pathlib,re,shutil,subprocess,sys,time,urllib.request
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
SOURCE=ROOT/"bin/s9_hub_playback.py"
BACK=ROOT/"backups/s9-360p-pilot-v10/backend-before-pilot.py"
UNIT="c720p-frontyard-security-new.service"
OLD='480p30-v4-verified';NEW='360p30-v5-pilot'
def run(*a):
 return subprocess.run(["systemctl","--user",*a],text=True,capture_output=True,check=True,timeout=35).stdout.strip()
def health():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as r:
  return json.load(r)
def restart():
 run("restart",UNIT)
 for i in range(25):
  try:
   if run("is-active",UNIT)=="active" and len(health().get("events",[]))>=250:return
  except Exception:pass
  time.sleep(.6)
 raise RuntimeError("proxy_unavailable")
def atomic(text):
 temp=SOURCE.with_suffix(".py.360p-stage")
 temp.write_text(text);temp.chmod(SOURCE.stat().st_mode&0o777)
 subprocess.run([sys.executable,"-m","py_compile",str(temp)],check=True,timeout=10)
 os.replace(temp,SOURCE)
def main():
 original=SOURCE.read_text()
 if len(health().get("events",[]))<250:raise RuntimeError("baseline_missing")
 if "--rollback" in sys.argv:
  if not BACK.exists():raise RuntimeError("pilot_backup_not_found")
  restored=BACK.read_text()
  if OLD not in restored:raise RuntimeError("backup_not_480p")
  atomic(restored);restart()
  print("S9_360P_PILOT_ROLLED_BACK",json.dumps({"profile":OLD,"archive_alive":True,"phone_modified":False}))
  return
 if NEW in original:print("S9_360P_PILOT_ALREADY_ACTIVE");return
 if original.count(OLD)!=1:raise RuntimeError("unexpected_backend_profile")
 expected={
  'scale_vaapi=w=854:h=480':'scale_vaapi=w=640:h=360',
  'scale=854:480':'scale=640:360',
  '"profile": "480p30"':'"profile": "360p30"',
  'data.get("profile") != "480p30"':'data.get("profile") != "360p30"',
  '"profile": "480p30"':'"profile": "360p30"',
  '"width"] > 854':'"width"] > 640',
  '"height"] > 480':'"height"] > 360',
  'get("width") or 0)>854':'get("width") or 0)>640',
  'get("height") or 0)>480':'get("height") or 0)>360',
  '"hub-derived-720p30"':'"hub-derived-360p30"',
 }
 updated=original.replace(OLD,NEW)
 for a,b in expected.items():
  if a not in updated:raise RuntimeError("no_anchor_"+a)
  updated=updated.replace(a,b)
 if 'scale_vaapi=w=640:h=360' not in updated or 'scale=640:360' not in updated:
  raise RuntimeError("ffmpeg_360_profile_missing")
 BACK.parent.mkdir(parents=True,exist_ok=True)
 if BACK.exists():raise RuntimeError("pilot_backup_already_exists")
 shutil.copy2(SOURCE,BACK)
 try:
  atomic(updated);restart()
  print("S9_360P_PILOT_LIVE",json.dumps({"profile":NEW,"archive_count":len(health().get("events",[])),"backup":str(BACK),"originals_modified":False}))
 except Exception:
  atomic(BACK.read_text())
  restart()
  raise
if __name__=="__main__":main()
