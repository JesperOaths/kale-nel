#!/usr/bin/env python3
"""Guarded Security playback relief: expensive full SD scan -> every 4 h,
while fast 1-minute metadata index persists. Correct misleading 720p UI
for verified 480p30 derived playback. Never alter camera or recordings.
"""
import datetime, json, os, pathlib, shutil, subprocess, urllib.request
HOME=pathlib.Path("/home/jespern")
TIMER=HOME/".config/systemd/user/c720p-s9-local-sd-catalog.timer"
PLAYER=pathlib.Path("/opt/homeassistant/config/www/security-video-playback.js")
PAGE=pathlib.Path("/opt/homeassistant/config/www/c720p-surveillance.html")
FAST="c720p-s9-fast-recent-clips.timer"
FULL="c720p-s9-local-sd-catalog.timer"
BACK=HOME/"c720p-home-hub/backups/security-playback-relief-v9"
def ctl(*a):
 p=subprocess.run(["systemctl","--user",*a],capture_output=True,text=True,timeout=20,check=True)
 return p.stdout.strip()
def archive():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=14) as r:return json.load(r)
def main():
 if not all(x.is_file() for x in (TIMER,PLAYER,PAGE)):raise RuntimeError("required_running_assets_missing")
 if ctl("is-active",FAST)!="active":raise RuntimeError("incremental_catalog_not_active")
 baseline=archive()
 if len(baseline.get("events",[]))<250:raise RuntimeError("archive_not_healthy")
 old_timer,old_player,old_page=(p.read_text() for p in (TIMER,PLAYER,PAGE))
 if "OnUnitInactiveSec=3min" not in old_timer or "OnUnitInactiveSec=4h" in old_timer:
  raise RuntimeError("full_catalog_timer_changed")
 if "Smooth playback · 720p / 30 fps" not in old_player:
  raise RuntimeError("player_label_anchor_changed")
 new_timer=old_timer.replace("OnUnitInactiveSec=3min","OnUnitInactiveSec=4h")
 new_player=old_player.replace("Smooth playback · 720p / 30 fps","Smooth playback · 480p / 30 fps")
 new_player=new_player.replace("Smooth \\u00b7 720p / 30 fps","Smooth \\u00b7 480p / 30 fps")
 new_player=new_player.replace("state.mode==='original'?'original':'720p30'","state.mode==='original'?'original':'480p30'")
 if new_player==old_player:raise RuntimeError("player_labels_no_change")
 mark="C720P_SECURITY_NATIVE_MJPEG_STABLE_V3_20261011"
 if mark not in old_page:raise RuntimeError("page_cache_marker_changed")
 new_page=old_page.replace(mark,"C720P_SECURITY_MJPEG_AND_480P_V9_20261011")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder=BACK/stamp;folder.mkdir(parents=True,mode=0o700)
 originals={TIMER:old_timer,PLAYER:old_player,PAGE:old_page}
 for path,txt in originals.items():(folder/path.name).write_text(txt)
 changed=[]
 try:
  for path,txt in ((TIMER,new_timer),(PLAYER,new_player),(PAGE,new_page)):
   temp=path.with_name(path.name+".playback-relief-stage")
   temp.write_text(txt)
   temp.chmod(path.stat().st_mode & 0o777)
   os.replace(temp,path);changed.append(path)
  ctl("daemon-reload")
  ctl("restart",FULL)
  if ctl("is-active",FULL)!="active" or ctl("is-active",FAST)!="active":
   raise RuntimeError("timers_not_active")
  with urllib.request.urlopen("http://127.0.0.1:8123/local/security-video-playback.js",timeout=10) as r:
   body=r.read(50000).decode()
   if "480p / 30 fps" not in body and "480p30" not in body:
    raise RuntimeError("player_http_readback_failed")
  after=archive()
  names={e.get("clip_no") for e in after.get("events",[])}
  if not {e.get("clip_no") for e in baseline["events"]}.issubset(names):
   raise RuntimeError("archive_items_disappeared")
  print("SECURITY_PLAYBACK_RELIEF_V9_DEPLOYED",json.dumps({
   "fast_index_interval":"1minute","full_scan_interval":"4hours",
   "fast_timer_active":True,"full_timer_active":True,
   "playback_ui_profile":"480p30","archive_clips":len(after["events"]),
   "original_recordings_untouched":True,"rollback":str(folder)
   },sort_keys=True),flush=True)
 except Exception:
  for path in reversed(changed):path.write_text(originals[path])
  try:ctl("daemon-reload");ctl("restart",FULL)
  except Exception:pass
  raise
if __name__=="__main__":main()
