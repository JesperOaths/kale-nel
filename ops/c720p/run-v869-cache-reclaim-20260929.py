#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, time, shutil, os, urllib.request

HOME=pathlib.Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
REPORT={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[]}

def run(cmd, timeout=60):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        return {"rc":p.returncode,"stdout":p.stdout[-16000:],"stderr":p.stderr[-4000:]}
    except Exception as e:
        return {"rc":99,"error":repr(e)}

def size(p):
    total=0
    try:
        if p.is_file(): return p.stat().st_size
        for q in p.rglob("*"):
            try:
                if q.is_file(): total+=q.stat().st_size
            except Exception: pass
    except Exception: pass
    return total

REPORT["df_before"]=run(["df","-B1","/"])
REPORT["state_top"]=run(["bash","-lc","du -x -BM --max-depth=2 /home/jespern/c720p-home-hub/state 2>/dev/null | sort -n | tail -100"],120)

# Disposable browser/cache material only. Preserve cookies, local storage, profiles,
# credentials, extensions, and application data.
targets=[]
profiles=[
 HOME/".config/c720p-kiosk-chromium",
 HOME/".config/c720p-spotify-chromium",
 HOME/".config/chromium",
]
relpaths=[
 "Default/Cache","Default/Code Cache","Default/GPUCache","Default/DawnCache",
 "Default/GrShaderCache","Default/ShaderCache","Default/Service Worker/CacheStorage",
 "Cache","Code Cache","GPUCache","DawnCache","GrShaderCache","ShaderCache",
]
for prof in profiles:
    for rel in relpaths:
        p=prof/rel
        if p.exists(): targets.append(p)
for p in [
 HOME/".cache/c720p-kiosk-chromium",
 HOME/".cache/c720p-spotify-chromium",
 HOME/".cache/chromium",
 HOME/".cache/selenium",
 BASE/"drive-playback-cache",
]:
    if p.exists(): targets.append(p)

# Deduplicate nested targets.
seen=[]
for p in sorted(targets,key=lambda x:len(str(x))):
    if any(str(p).startswith(str(q)+os.sep) or p==q for q in seen): continue
    seen.append(p)

# Pause only kiosk/Spotify browser services while deleting their disposable caches.
REPORT["kiosk_before"]=run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],15)
REPORT["spotify_before"]=run(["systemctl","--user","is-active","c720p-spotify-browser.service"],15)
run(["systemctl","--user","stop","c720p-home-hub-kiosk.service"],30)
run(["systemctl","--user","stop","c720p-spotify-browser.service"],30)

for p in seen:
    before=size(p)
    try:
        if p.is_dir(): shutil.rmtree(p)
        elif p.exists(): p.unlink()
        REPORT["deleted"].append({"path":str(p),"bytes":before})
    except Exception as e:
        REPORT["deleted"].append({"path":str(p),"bytes":before,"error":repr(e)})

# Keep journal bounded; do not remove current logs.
REPORT["journal_vacuum"]=run(["journalctl","--user","--vacuum-size=35M"],60)

# Restart kiosk. Spotify remains demand-started unless it had been active.
run(["systemctl","--user","start","c720p-home-hub-kiosk.service"],45)
if "active" in REPORT["spotify_before"].get("stdout",""):
    run(["systemctl","--user","start","c720p-spotify-browser.service"],45)

REPORT["df_after"]=run(["df","-B1","/"])
REPORT["kiosk_after"]=run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],15)
REPORT["freed_bytes"]=sum(x.get("bytes",0) for x in REPORT["deleted"] if not x.get("error"))
REPORT["finished_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())

# Report through existing bridge.
try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "maintenance":{"v869_cache_reclaim_990033":REPORT}}
    req=urllib.request.Request(
      "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
      data=json.dumps(payload,separators=(",",":")).encode(),method="POST",
      headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=20) as r: REPORT["health_post_status"]=r.status
except Exception as e: REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
