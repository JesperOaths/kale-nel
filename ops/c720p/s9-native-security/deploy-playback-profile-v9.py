#!/usr/bin/env python3
"""Atomic local C720P playback profile/cache bug repair.

A previous low-cost 480p30 transcode reused the 720p30-v2 cache key and
accepted 720p artefacts. Make new key profile-specific and fail closed against
wrong derived media. Never modify/delete phone-original videos.
"""
import datetime, json, os, pathlib, py_compile, shutil, subprocess, time, urllib.request
TARGET=pathlib.Path("/home/jespern/c720p-home-hub/bin/s9_hub_playback.py")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/s9-playback-profile-v9")
UNIT="c720p-frontyard-security-new.service"
OLD='PROFILE = "480p30-v3"'
NEW='PROFILE = "480p30-v4-verified"'
ANCHOR='        if data.get("key") != src["key"] or not 10000 <= path.stat().st_size <= FILE_MAX:\n            return None'
GUARD='        if (data.get("profile") != "480p30" or int(data.get("width") or 0)>854 or\n                int(data.get("height") or 0)>480 or float(data.get("fps") or 0)<29.9):\n            return None'
def check(url):
 with urllib.request.urlopen(url,timeout=14) as r:return r.status
def ctl(*args):
 return subprocess.run(["systemctl","--user",*args],capture_output=True,text=True,timeout=35,check=True).stdout.strip()
def main():
 if not TARGET.is_file():raise RuntimeError("playback_source_missing")
 original=TARGET.read_text()
 if NEW in original and GUARD in original:
  print("PROFILE_ALREADY_CORRECT")
  return
 if original.count(OLD)!=1 or original.count(ANCHOR)!=1:
  raise RuntimeError("unexpected_cache_source")
 if "scale=854:480" not in original or '"profile": "480p30"' not in original:
  raise RuntimeError("480p_transcode_not_configured")
 start=check("http://127.0.0.1:8795/new/api/saved")
 if start!=200:raise RuntimeError("baseline_unhealthy")
 updated=original.replace(OLD,NEW).replace(ANCHOR,ANCHOR+"\n"+GUARD)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 dest=BACK/stamp
 dest.mkdir(parents=True,mode=0o700)
 backup=dest/"s9_hub_playback.py"
 shutil.copy2(TARGET,backup)
 tmp=TARGET.with_suffix(".py.v9-stage")
 try:
  tmp.write_text(updated);tmp.chmod(TARGET.stat().st_mode & 0o777)
  py_compile.compile(str(tmp),cfile=str(dest/"parse-check.pyc"),doraise=True)
  os.replace(tmp,TARGET)
  ctl("restart",UNIT)
  good=False
  for attempt in range(22):
   try:
    good=ctl("is-active",UNIT)=="active" and check("http://127.0.0.1:8795/new/api/saved")==200
    if good:break
   except Exception:pass
   time.sleep(.8)
  if not good:raise RuntimeError("media_proxy_restart_not_ready")
  print("S9_480P_CACHE_PROFILE_FIXED",json.dumps({
   "active":True,"profile":NEW,"reject_720p_cached_files":True,
   "originals_modified":False,"backup":str(backup),
   "archive_http":200,"service":UNIT},sort_keys=True),flush=True)
 except Exception:
  shutil.copy2(backup,TARGET)
  try:ctl("restart",UNIT)
  except Exception:pass
  raise
 finally:tmp.unlink(missing_ok=True)
if __name__=="__main__":main()
