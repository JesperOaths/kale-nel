#!/usr/bin/env python3
"""Guarded Security GPU mode rollout. Adds optional per-video performance button.

Source videos, native Security player, HA root shell, camera, and archive API
remain intact. The viewer & launcher are private same-origin assets. Reversible.
"""
import datetime, json, os, pathlib, re, shutil, subprocess, urllib.request

ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
BUILD=pathlib.Path("/home/jespern/c720p-home-hub/build/security-v8")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/security-gpu-player-v1")
VIEW=ROOT/"gpu-performance-player-v1.html"
LAUNCH=ROOT/"security-gpu-launcher-v1.js"
SOURCE_VIEW=BUILD/"gpu-performance-player-v1.html"
SOURCE_LAUNCH=BUILD/"security-gpu-launcher-v1.js"
PAGES=[
 ROOT/"security-review-v8.html",
 ROOT/"security-archive-v7.html",
 ROOT/"security-tracks-v7.html",
 ROOT/"face-appearances.html",
]
TAG='<script src="./security-gpu-launcher-v1.js?v=S9_GPU_PLAYER_V1_20261012"></script>'
def get(url):
 with urllib.request.urlopen(url,timeout=15) as r:return r.status,r.read(260000)
def parse_js(source):
 if not isinstance(source,str) or len(source)<1800:raise RuntimeError("javascript_too_small")
 p=BUILD/"__gpu_player_js_check__.js"
 p.write_text(source)
 try:subprocess.run(["node","--check",str(p)],check=True,capture_output=True,text=True,timeout=16)
 finally:p.unlink(missing_ok=True)
def main():
 if not SOURCE_VIEW.is_file() or not SOURCE_LAUNCH.is_file():
  raise RuntimeError("gpu_viewer_staged_files_missing")
 viewer=SOURCE_VIEW.read_text()
 launcher=SOURCE_LAUNCH.read_text()
 if ('gejast-auth-gate.js' not in viewer or 'C720PSecureRelay' not in viewer or
      'id="s9-gpu-player-v1"' not in viewer or 'playback=rgb_prepare' not in viewer or
      'playback=rgb_pack' not in viewer or 'UNSIGNED' in viewer):
  raise RuntimeError("unsafe_gpu_player_template")
 if "s9-gpu-performance-close-v1" not in launcher or "new MutationObserver(" not in launcher:
  raise RuntimeError("unsafe_gpu_launcher")
 script=re.search(r'<script id="s9-gpu-player-v1">([\s\S]*?)</script>',viewer)
 if not script:raise RuntimeError("viewer_inline_script_missing")
 parse_js(script.group(1));parse_js(launcher)
 baseline,_=get("http://127.0.0.1:8795/new/api/saved")
 if baseline!=200:raise RuntimeError("baseline_archive_offline")
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=14) as r:a=json.load(r)
 originals={x.get("clip_no") for x in a.get("events",[])}
 if a.get("archive_mode")!="S9-microSD-only" or len(originals)<250:
  raise RuntimeError("wrong_archive_or_missing_clips")
 existing={}
 updated={}
 for p in (VIEW,LAUNCH,*PAGES):
  if not p.parent.is_dir() or p.is_symlink():raise RuntimeError("unsafe_target_file")
  existing[p]=p.read_bytes() if p.is_file() else None
 for p in PAGES:
  if existing[p] is None:raise RuntimeError("security_page_missing_"+p.name)
  current=existing[p].decode()
  if '<video' not in current and "createElement('video')" not in current and "createElement(\"video\")" not in current:
   if p.name!="face-appearances.html" and p.name!="security-tracks-v7.html":
    raise RuntimeError("unexpected_page_without_video_"+p.name)
  if TAG in current:
   updated[p]=current
  else:
   if current.count("</body>")!=1:raise RuntimeError("security_html_missing_body_"+p.name)
   updated[p]=current.replace("</body>",TAG+"\n</body>",1)
 updated[VIEW]=viewer
 updated[LAUNCH]=launcher
 BACK.mkdir(parents=True,exist_ok=True)
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 for i,(p,data) in enumerate(existing.items()):
  if data is not None:(folder/(str(i)+"-"+p.name)).write_bytes(data)
 written=[]
 try:
  for p,s in updated.items():
   tmp=p.with_name(p.name+".gpu-staging")
   tmp.write_text(s)
   tmp.chmod(p.stat().st_mode&0o777 if p.exists() else 0o644)
   os.replace(tmp,p);written.append(p)
  status,html=get("http://127.0.0.1:8123/local/frontyard-security-new/gpu-performance-player-v1.html")
  status2,js=get("http://127.0.0.1:8123/local/frontyard-security-new/security-gpu-launcher-v1.js")
  if status!=200 or b's9-gpu-player-v1' not in html or status2!=200 or b'__S9GpuLauncherV1' not in js:
   raise RuntimeError("http_asset_readback_failed")
  for p in PAGES:
   st,body=get("http://127.0.0.1:8123/local/frontyard-security-new/"+p.name)
   if st!=200 or b"S9_GPU_PLAYER_V1_20261012" not in body:raise RuntimeError("frontend_page_readback_"+p.name)
  with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=14) as r:b=json.load(r)
  if not originals.issubset({x.get("clip_no") for x in b.get("events",[])}):
   raise RuntimeError("security_archive_changed")
  print("S9_SECURITY_GPU_PLAYER_OPTION_DEPLOYED",json.dumps({
   "files":[p.name for p in written],"archive_clips":len(b["events"]),
   "private_webgl_player":True,"optional_per_clip_button":True,
   "original_player_untouched":True,"phone_untouched":True,
   "backup":str(folder)},sort_keys=True))
 except Exception:
  for p in reversed(written):
   prior=existing[p]
   if prior is None:p.unlink(missing_ok=True)
   else:p.write_bytes(prior)
  raise
if __name__=="__main__":main()
