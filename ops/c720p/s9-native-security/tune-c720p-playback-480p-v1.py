#!/usr/bin/env python3
"""Guarded lighter MP4 replay on weak C720P kiosk, original S9 microSD immutable.

Encode derived 854x480 30fps baseline AVC copy instead of 720p30 for SMOOTH mode.
Video files stay untouched; all derived cache in /tmp, capped by existing quota.
This is a reversible fallback until on-phone hardware transcoding is production ready.
"""
from pathlib import Path
from datetime import datetime,timezone
import importlib.util,json,os,shutil,subprocess,time,urllib.request
SRC=Path('/home/jespern/c720p-home-hub/bin/s9_hub_playback.py')
BACK=Path('/home/jespern/c720p-home-hub/backups/security-playback-performance')
SERVICE='c720p-frontyard-security-new.service'

EDITS=[
 ('PROFILE = "720p30-v2"','PROFILE = "480p30-v3"'),
 ('scale_vaapi=w=1280:h=720:','scale_vaapi=w=854:h=480:'),
 ('scale=1280:720:','scale=854:480:'),
 ('"3500k"','"1800k"'),('"7000k"','"3600k"'),
 ('"720p30"','"480p30"'),
 ('output["width"] > 1280','output["width"] > 854'),
 ('output["height"] > 720','output["height"] > 480')
]
def system(*cmd,timeout=45):
 p=subprocess.run(cmd,timeout=timeout,capture_output=True,text=True)
 if p.returncode:raise RuntimeError('service_command_failed: '+p.stderr[-300:])
 return p.stdout.strip()
def request(url,timeout=7):
 with urllib.request.urlopen(url,timeout=timeout) as r:return r.status,r.read(200000)
def await_service():
 for n in range(35):
  try:
   s,body=request('http://127.0.0.1:8793/status',timeout=4)
   if s==200:return
  except Exception:pass
  try:
   s,_=request('http://127.0.0.1:8793/new/api/saved',timeout=4)
   if s==200:return
  except Exception:pass
  time.sleep(.6)
 raise RuntimeError('camera_relay_never_returned')
def main():
 if not SRC.is_file() or SRC.is_symlink():raise RuntimeError('playback_source_missing')
 orig=SRC.read_text()
 if not 8000<len(orig)<40000:raise RuntimeError('unknown_source_size')
 patched=orig
 for old,new in EDITS:
  count=patched.count(old)
  if count<1:raise RuntimeError('unexpected_profile_source: '+old)
  patched=patched.replace(old,new)
 # An original at the same time may have no cached conversion. No originals
 # are ever written, deleted or overwritten, and the 4K source is the truth.
 now=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/('s9_hub_playback-'+now+'.py')
 shutil.copy2(SRC,backup)
 stage=SRC.with_name(SRC.name+'.480p-v1-stage')
 stage.write_text(patched);stage.chmod(SRC.stat().st_mode&0o777)
 system('/usr/bin/python3','-m','py_compile',str(stage))
 # Pure function tests before changing running app.
 compile(patched,str(stage),'exec')
 if patched.count('fps=30')<2 or '480p30-v3' not in patched:
  raise RuntimeError('output_not_30_fps')
 if not ('854:h=480' in patched and 'scale=854:480' in patched):
  raise RuntimeError('scale_profile_incomplete')
 previous_active=system('systemctl','--user','is-active',SERVICE)
 if previous_active!='active':raise RuntimeError('recording_relay_not_active')
 replaced=False
 try:
  os.replace(stage,SRC);replaced=True
  system('systemctl','--user','restart',SERVICE,timeout=40)
  await_service()
  # Must remain separate from the S9 Camera2 4K capture.
  camera,_=request('http://127.0.0.1:18808/status',timeout=7)
  archive,data=request('http://127.0.0.1:8795/new/api/saved',timeout=10)
  num=len(json.loads(data).get('events',[]))
  if camera!=200 or archive!=200 or num<273:raise RuntimeError('camera_archive_regressed')
  print('S9_480P30_SMOOTH_PROFILE_DEPLOYED',json.dumps({
   'profile':'480p30-v3','resolution':'854x480','fps':30,
   'backed_up':str(backup),'archive_count':num,
   'camera_capture_changed':False,'original_media_changed':False,
   'relay_restored':True,'source_profile_previous':'720p30-v2'},sort_keys=True))
 except Exception:
  if replaced:
   shutil.copy2(backup,SRC)
   try:system('systemctl','--user','restart',SERVICE,timeout=40)
   except Exception:pass
  raise
if __name__=='__main__':main()
