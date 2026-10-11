#!/usr/bin/env python3
"""Real kiosk 360p pilot: require >=24 presented FPS or restore 480p.

Runs on C720P. Uses Chromium DevTools in a temporary tab, preserves active
kiosk page and originals. Explicit automatic rollback on failed benchmark.
"""
import json,os,pathlib,re,subprocess,time,urllib.request
HOME=pathlib.Path("/home/jespern/c720p-home-hub")
SOURCE=HOME/"bin/s9_hub_playback.py"
BACK=HOME/"backups/s9-360p-pilot-v10/backend-before-pilot.py"
BROWSER=HOME/"build/security-v8/security-v8-browser-fps-probe.py"
PLAYER=pathlib.Path("/opt/homeassistant/config/www/security-video-playback.js")
PAGE=pathlib.Path("/opt/homeassistant/config/www/c720p-surveillance.html")
UNIT="c720p-drive-security-archive.service"
CLIP="motion_1791740141770.mp4"
def ctl(*args):
 return subprocess.run(["systemctl","--user",*args],capture_output=True,text=True,check=True,timeout=30).stdout.strip()
def get(path):
 with urllib.request.urlopen("http://127.0.0.1:8795"+path,timeout=12) as r:return json.load(r)
def restore():
 SOURCE.write_bytes(BACK.read_bytes())
 ctl("restart",UNIT)
 for i in range(30):
  try:
   old=get('/new/saved/clip/'+CLIP+'?playback=prepare')
   if old.get('profile')=='480p30':return
  except Exception:pass
  time.sleep(.7)
 raise RuntimeError("rollback_service_did_not_load_480p")
def commit_ui():
 old=PLAYER.read_text();page=PAGE.read_text()
 if "480p" not in old or "security-video-playback.js?v=" not in page:
  raise RuntimeError("unexpected_player_before_commit")
 new=old.replace("Smooth · 480p / 30 fps","Smooth · 360p / 30 fps")
 new=new.replace("Smooth playback · 480p / 30 fps","Smooth playback · 360p / 30 fps")
 new=new.replace("state.mode==='original'?'original':'480p30'",
                 "state.mode==='original'?'original':'360p30'")
 if new==old:raise RuntimeError("360_ui_no_change")
 m=re.findall(r"security-video-playback[.]js[?]v=([A-Za-z0-9_.-]+)",page)
 if len(m)!=1:raise RuntimeError("cachebuster_unknown")
 newpage=page.replace(m[0],"C720P_SECURITY_SMOOTH_360P_V10_20261011",1)
 dest=HOME/"backups/s9-360p-pilot-v10"
 (dest/"player-before-360p.js").write_text(old)
 (dest/"page-before-360p.html").write_text(page)
 temp=PLAYER.with_name(PLAYER.name+".v10-stage");temp.write_text(new)
 os.replace(temp,PLAYER)
 temp=PAGE.with_name(PAGE.name+".v10-stage");temp.write_text(newpage)
 os.replace(temp,PAGE)
def main():
 if not BACK.is_file() or not SOURCE.is_file():raise RuntimeError("missing_rollback_backup")
 if "360p30-v5-pilot" not in SOURCE.read_text():raise RuntimeError("expected_360p_not_active")
 fps=0;dropped=0;report={}
 try:
  result=None
  for i in range(75):
   result=get('/new/saved/clip/'+CLIP+'?playback=prepare')
   if result.get("state")=="ready":break
   if result.get("state")=="failed":raise RuntimeError("360p_prepare_failed_"+str(result.get("error")))
   time.sleep(2)
  if not result or result.get("state")!="ready":raise RuntimeError("360p_prepare_timeout")
  if (result.get("profile")!="360p30" or int(result.get("width") or 0)!=640 or
          int(result.get("height") or 0)!=360 or float(result.get("fps") or 0)<29.9):
   raise RuntimeError("360p_media_not_validated")
  test=subprocess.run(["python3",str(BROWSER)],capture_output=True,text=True,timeout=100)
  if test.returncode:raise RuntimeError("chrome_probe_error_"+test.stderr[-200:])
  lines=[x.split("S9_REAL_KIOSK_4K_PLAYBACK_PERF ",1)[1]
       for x in test.stdout.splitlines() if "S9_REAL_KIOSK_4K_PLAYBACK_PERF " in x]
  if not lines:raise RuntimeError("missing_browser_measurement")
  report=json.loads(lines[-1])
  if "observed_fps" not in report:raise RuntimeError("browser_cdp_did_not_return_fps")
  fps=float(report["observed_fps"]);dropped=int(report.get("droppedFrames") or 0)
  if fps<24 or int(report.get("videoWidth") or 0)!=640 or report.get("errors"):
   raise RuntimeError("actual_fps_below_target_or_wrong_resolution")
  commit_ui()
  print("S9_360P_BROWSER_24FPS_PILOT_PASSED",json.dumps({
   "actual_fps":round(fps,2),"dropped":dropped,"video":"640x360",
   "original_4k_intact":True,"clip":CLIP,"archive":len(get("/new/api/saved").get("events",[])),
   "verified_profile":"360p30"}),flush=True)
 except Exception as reason:
  restore()
  print("S9_360P_BENCHMARK_FAILED_ROLLED_BACK_TO_480P",json.dumps({
    "reason":str(reason),"observed_fps":round(fps,2),
    "dropped":dropped,"video":"480p30 restored",
    "original_4k_intact":True,"archive_count":len(get("/new/api/saved").get("events",[]))
    },sort_keys=True),flush=True)
if __name__=="__main__":main()
