#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import datetime
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
UNIT=HOME/".config/systemd/user"
VISION_SU=UNIT/"c720p-saved-thumbnailer-v106.service"
VISION_TU=UNIT/"c720p-saved-thumbnailer-v106.timer"
FAST_SU=UNIT/"c720p-saved-fast-thumbnailer-v112.service"
FAST_TU=UNIT/"c720p-saved-fast-thumbnailer-v112.timer"
UI=WWW/"c720p-drive-saved.html"
SURV=WWW/"c720p-surveillance.html"
MAN=WWW/"c720p-saved-thumbs/manifest.json"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-thumbnail-v114-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

def backup(p):
    p=Path(p)
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

for p in (VISION_SU,VISION_TU,FAST_SU,FAST_TU,UI,SURV,MAN):
    backup(p)

# The fast coverage worker does not use the DNN. Give both workers a small
# manifest-only lock, while leaving the expensive V108 detector on its vision lock.
# This prevents manifest write races without unnecessarily blocking camera vision.
vs=VISION_SU.read_text()
vision_exec=(
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-vision.lock "
    "/usr/bin/flock -n -E 0 /run/user/1000/c720p-thumb-manifest.lock "
    "/home/jespern/c720p-home-hub/person-detector/venv/bin/python "
    "/home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v108.py"
)
vs,n=re.subn(r"^ExecStart=.*$",vision_exec,vs,count=1,flags=re.M)
if n!=1: raise SystemExit("VISION_EXECSTART_NOT_FOUND")
VISION_SU.write_text(vs)

fs=FAST_SU.read_text()
fast_exec=(
    "ExecStart=/usr/bin/flock -n -E 0 /run/user/1000/c720p-thumb-manifest.lock "
    "/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-saved-fast-thumbnailer-v112.py"
)
fs,n=re.subn(r"^ExecStart=.*$",fast_exec,fs,count=1,flags=re.M)
if n!=1: raise SystemExit("FAST_EXECSTART_NOT_FOUND")
fs=re.sub(r"^Environment=C720P_FAST_THUMB_LIMIT=.*$","Environment=C720P_FAST_THUMB_LIMIT=3",fs,flags=re.M)
FAST_SU.write_text(fs)

ft=FAST_TU.read_text()
ft=re.sub(r"^OnBootSec=.*$","OnBootSec=1min",ft,flags=re.M)
ft=re.sub(r"^OnUnitInactiveSec=.*$","OnUnitInactiveSec=2min",ft,flags=re.M)
ft=re.sub(r"^RandomizedDelaySec=.*$","RandomizedDelaySec=20s",ft,flags=re.M)
FAST_TU.write_text(ft)

# Make the temporary/fallback single-frame preview semantically correct in the UI.
# A broken image should not print a giant misleading "Three moments..." alt string.
u=UI.read_text()
old=""" let src='';
 try{
  const m=await thumbManifest(),rec=m?.items?.[String(e.remote_name||'')];
  if(rec?.url)src=rec.url+'?v='+Math.floor(Number(rec.generated_at||0));
 }catch(_){}"""
new=""" let src='',rec=null;
 try{
  const m=await thumbManifest();rec=m?.items?.[String(e.remote_name||'')]||null;
  if(rec?.url)src=rec.url+'?v='+Math.floor(Number(rec.generated_at||0));
 }catch(_){}"""
if old not in u and "let src='',rec=null;" not in u:
    raise SystemExit("UI_THUMB_REC_ANCHOR_NOT_FOUND")
if old in u:u=u.replace(old,new,1)

old_alt="const img=new Image();img.className='thumb';img.alt='Three moments from camera clip '+String(e.clip_no||'');img.decoding='async';"
new_alt="""const img=new Image();img.className='thumb';img.alt='';img.decoding='async';
 img.onload=()=>{img.alt=(rec?.thumbnail_method==='person-model+motion'?'Three selected moments from':'Preview frame from')+' camera clip '+String(e.clip_no||'');wrap.classList.add('loaded');const m=wrap.querySelector('.thumbUnavailable');if(m)m.remove()};"""
if old_alt in u:
    u=u.replace(old_alt,new_alt,1)
    # Remove the now-duplicated previous onload statement.
    u=u.replace(" img.onload=()=>{wrap.classList.add('loaded');const m=wrap.querySelector('.thumbUnavailable');if(m)m.remove()};\n","",1)
elif "img.alt='';img.decoding='async';" not in u:
    raise SystemExit("UI_ALT_ANCHOR_NOT_FOUND")

if "C720P_SAVED_THUMB_V114" not in u:
    u=u.replace("</head>",'<meta name="c720p-saved-thumb-build" content="C720P_SAVED_THUMB_V114">\\n</head>',1)
UI.write_text(u)

# Force the security shell to request the repaired child document, without altering layout.
sv=SURV.read_text()
sv=re.sub(
    r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+',
    '/local/c720p-drive-saved.html?camera=camera&v=SAVED_THUMB_V114_20261007',
    sv
)
SURV.write_text(sv)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now",VISION_TU.name],check=True,timeout=30)
subprocess.run(["systemctl","--user","enable","--now",FAST_TU.name],check=True,timeout=30)

# Start the fast worker once. With full coverage this should be a sub-second no-op.
r=subprocess.run(["systemctl","--user","start",FAST_SU.name],text=True,capture_output=True,timeout=60)
if r.returncode not in (0,):
    raise SystemExit("FAST_WORKER_START_FAILED:"+r.stderr[-1200:])

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False,timeout=25)

# Validate every saved thumbnail as it is actually served by Home Assistant.
manifest=json.loads(MAN.read_text())
items=manifest.get("items",{})
with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t="+str(time.time()),timeout=60) as rr:
    events=json.loads(rr.read().decode()).get("events",[])

missing=[]
bad_http=[]
for e in events:
    name=str(e.get("remote_name") or "")
    rec=items.get(name) if isinstance(items,dict) else None
    rel=str((rec or {}).get("url") or "")
    if not rec or not rel:
        missing.append(name);continue
    f=WWW/"c720p-saved-thumbs"/str(rec.get("file") or "")
    if not f.is_file() or f.stat().st_size<=2500:
        missing.append(name);continue
    try:
        with urllib.request.urlopen("http://127.0.0.1:8123"+rel,timeout=8) as resp:
            head=resp.read(2048)
            ctype=str(resp.headers.get("Content-Type") or "")
            if resp.status!=200 or "image" not in ctype or len(head)<1000:
                bad_http.append(name)
    except Exception:
        bad_http.append(name)

# Verify the repaired saved-snapshot compatibility route on one of the originally
# broken screenshot clips.
target=next((e for e in events if int(e.get("clip_no") or -1)==143 and str(e.get("timestamp") or "").startswith("2026-09-25 23:55")),None)
route={}
if target and target.get("snapshot_name"):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8795/new/saved/snap/"+str(target["snapshot_name"]),timeout=30) as resp:
            b=resp.read(2048)
            route={"status":resp.status,"content_type":resp.headers.get("Content-Type"),"bytes_read":len(b)}
    except Exception as exc:
        route={"error":str(exc)}

print(json.dumps({
    "ok":not missing and not bad_http and route.get("status")==200,
    "version":"v114",
    "backup":str(BACK),
    "saved_events":len(events),
    "local_file_missing":len(missing),
    "http_thumbnail_failures":len(bad_http),
    "saved_snapshot_route":route,
    "manifest_version":manifest.get("version"),
    "vision_timer_active":subprocess.run(["systemctl","--user","is-active",VISION_TU.name],text=True,capture_output=True).stdout.strip(),
    "fast_timer_active":subprocess.run(["systemctl","--user","is-active",FAST_TU.name],text=True,capture_output=True).stdout.strip(),
    "fast_service_exec":next((x for x in FAST_SU.read_text().splitlines() if x.startswith("ExecStart=")),""),
    "vision_service_exec":next((x for x in VISION_SU.read_text().splitlines() if x.startswith("ExecStart=")),""),
    "ui_v114":"C720P_SAVED_THUMB_V114" in UI.read_text(),
},indent=2))
