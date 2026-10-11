#!/usr/bin/env python3
"""Guarded optimization: make CPU-heavy ffmpeg 4K->smooth copies low-priority.

On Acer C720P dual-core, generating a smooth copy may otherwise starve the
Chromium compositor. Does not change source video, transcode format, person
detection, voice or lamps. Requires exact two known FFmpeg invocation sites.
"""
import json,os,pathlib,shutil,subprocess,time,datetime,urllib.request
SRC=pathlib.Path("/home/jespern/c720p-home-hub/bin/s9_hub_playback.py")
UNIT="c720p-drive-security-archive.service"
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/s9-playback-nice-v12")
TAG="S9_C720P_BACKGROUND_FFMPEG_NICE_V12"
OLD_HW="subprocess.run(transcode_command(src, part, hardware=True),"
OLD_SW="subprocess.run(transcode_command(src, part),"
NEW_HW='subprocess.run(["/usr/bin/nice", "-n", "12", *transcode_command(src, part, hardware=True)],'
NEW_SW='subprocess.run(["/usr/bin/nice", "-n", "12", *transcode_command(src, part)],'
def run(*cmd,timeout=35):
 p=subprocess.run(cmd,check=True,capture_output=True,text=True,timeout=timeout)
 return p.stdout.strip()
def health():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:
  d=json.load(r)
 if len(d.get("events",[]))<250:return False
 return True
def wait_service():
 for i in range(27):
  try:
   if run("systemctl","--user","is-active",UNIT)=="active" and health():return True
  except Exception:pass
  time.sleep(.6)
 return False
def main():
 if not SRC.is_file() or SRC.is_symlink():raise RuntimeError("source_missing_or_symlink")
 old=SRC.read_text()
 if TAG in old:
  print("S9_BACKGROUND_FFMPEG_PRIORITY_ALREADY_DEPLOYED")
  return
 if old.count(OLD_HW)!=1 or old.count(OLD_SW)!=1:raise RuntimeError("unknown_ffmpeg_invocation_layout")
 if not pathlib.Path("/usr/bin/nice").is_file():raise RuntimeError("nice_not_installed")
 if not health():raise RuntimeError("archive_baseline_unhealthy")
 new=old.replace(OLD_HW,NEW_HW).replace(OLD_SW,NEW_SW)
 new="# "+TAG+"\n"+new
 BACK.mkdir(parents=True,exist_ok=True)
 now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/("s9_hub_playback_"+now+".py")
 shutil.copy2(SRC,backup)
 staged=SRC.with_name(SRC.name+".ffmpeg-priority-stage")
 try:
  staged.write_text(new)
  staged.chmod(SRC.stat().st_mode&0o777)
  run("python3","-m","py_compile",str(staged))
  os.replace(staged,SRC)
  run("systemctl","--user","restart",UNIT)
  if not wait_service():raise RuntimeError("archive_proxy_not_healthy_after_restart")
  assert TAG in SRC.read_text()
  print("S9_BACKGROUND_FFMPEG_PRIORITY_DEPLOYED",json.dumps({
    "nice":12,"ffmpeg_backends":2,"original_videos_modified":False,
    "camera_modified":False,"archive_healthy":True,"backup":str(backup)},sort_keys=True))
 except Exception:
  staged.unlink(missing_ok=True)
  shutil.copy2(backup,SRC)
  try:run("systemctl","--user","restart",UNIT)
  except Exception:pass
  raise
if __name__=="__main__":main()
