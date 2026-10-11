#!/usr/bin/env python3
"""Guarded browser playback pilot: 360p @ 25fps, source always unchanged.

Keeping the encoded rate close to the >=24 presented-FPS requirement reduces
software decoder workload on the C720P. --rollback restores 360p30.
"""
import json,os,pathlib,py_compile,shutil,subprocess,sys,time,urllib.request
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
SRC=ROOT/"bin/s9_hub_playback.py"
BACK=ROOT/"backups/s9-360p25-pilot-v11/360p30-before-fps25.py"
UNIT="c720p-drive-security-archive.service"
FROM='360p30-v5-pilot';TO='360p25-v6-pilot'
def ctl(*a):
 p=subprocess.run(["systemctl","--user",*a],capture_output=True,text=True,timeout=35,check=True)
 return p.stdout.strip()
def prepared():
 with urllib.request.urlopen('http://127.0.0.1:8795/new/saved/clip/motion_1791739041453.mp4?playback=prepare',timeout=15) as r:
  return json.load(r)
def atomic(s):
 p=SRC.with_name(SRC.name+".v11-stage");p.write_text(s);p.chmod(SRC.stat().st_mode&0o777)
 py_compile.compile(str(p),cfile="/tmp/s9-fps25-profile-check.pyc",doraise=True)
 os.replace(p,SRC)
def restart(expected):
 ctl("restart",UNIT)
 for i in range(35):
  try:
   d=prepared()
   if d.get('profile')==expected and d.get('state') in ('queued','preparing','ready'):return d
  except Exception:pass
  time.sleep(.6)
 raise RuntimeError("wrong_active_archive_playback_profile")
def main():
 if not SRC.is_file():raise RuntimeError("playback_source_absent")
 original=SRC.read_text()
 if '--rollback' in sys.argv:
  if not BACK.is_file():raise RuntimeError("rollback_backup_missing")
  if FROM not in BACK.read_text():raise RuntimeError("backup_incorrect")
  atomic(BACK.read_text());d=restart("360p30")
  print('S9_360P25_ROLLED_BACK',json.dumps({'profile':d['profile'],'state':d['state']}))
  return
 if TO in original:print('S9_360P25_ALREADY_STAGED');return
 if original.count(FROM)!=1 or original.count('fps=30')!=2 or '29.9' not in original:
  raise RuntimeError("source_not_expected_360p30")
 replace=[
  (FROM,TO),('fps=30','fps=25'),('29.9','24.9'),
  ('"profile": "360p30"','"profile": "360p25"'),
  ('data.get("profile") != "360p30"','data.get("profile") != "360p25"'),
  ('"-g", "60"','"-g", "50"'),
  ('hub-derived-360p30','hub-derived-360p25')
 ]
 edited=original
 for a,b in replace:
  if a not in edited:raise RuntimeError("missing_"+a)
  edited=edited.replace(a,b)
 BACK.parent.mkdir(parents=True,exist_ok=True)
 if BACK.is_file():raise RuntimeError("pilot_backup_already_exists")
 shutil.copy2(SRC,BACK)
 try:
  atomic(edited)
  state=restart('360p25')
  print('S9_360P25_PILOT_ACTIVE',json.dumps({'profile':state['profile'],
    'state':state['state'],'original_media_unchanged':True,'backup':str(BACK)}))
 except Exception:
  atomic(BACK.read_text())
  restart('360p30')
  raise
if __name__=="__main__":main()
