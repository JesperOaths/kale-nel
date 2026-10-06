#!/usr/bin/env python3
from pathlib import Path
import datetime, json, re, shutil, subprocess, time

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
SURV=WWW/"c720p-surveillance.html"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"remove-s3-security-ui-v25-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(SURV,BACK/(SURV.name+".before"))

s=SURV.read_text(encoding="utf-8",errors="replace")

# Cache control inside the iframe itself.
if 'http-equiv="Cache-Control"' not in s:
    s=s.replace(
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0">',
        1,
    )

# Remove the old generic "hide S3" CSS/script shim. We want no S3 DOM at all.
s=re.sub(
    r'<!-- C720P_V865B_HIDE_S3_ONLY -->\s*<style>.*?</style>\s*<script>.*?</script><!-- C720P_SECURITY_V83_S9_ONLY_LIVE_NO_S3_STATUS -->',
    '<!-- C720P_SECURITY_V84_SINGLE_CAMERA_ONLY -->',
    s,
    count=1,
    flags=re.S,
)
s=s.replace('<!-- C720P_SECURITY_V83_S9_ONLY_LIVE_NO_S3_STATUS -->','<!-- C720P_SECURITY_V84_SINGLE_CAMERA_ONLY -->')
s=s.replace('<!-- C720P_SECURITY_S9_LIVE_ONLY_V82 -->','<!-- C720P_SECURITY_SINGLE_LIVE_V84 -->')

# Header: remove all S3-specific tabs and rename the live tab semantics.
s=re.sub(r'<button class="tab" data-tab="old">.*?</button>','',s,count=1,flags=re.S)
s=re.sub(r'<button class="tab" data-tab="s3Saved">.*?</button>','',s,count=1,flags=re.S)
s=s.replace('data-tab="both">Live camera','data-tab="live">Live camera')

# Remove S3 historical panels from this page (data on disk is left untouched).
s=re.sub(r'<section class="panel" id="panel-old">.*?</section>','',s,count=1,flags=re.S)
s=re.sub(r'<section class="panel" id="panel-s3Saved">.*?</section>','',s,count=1,flags=re.S)
s=s.replace('id="panel-both"','id="panel-live"')

# Camera controls: remove the old-camera control card.
s=re.sub(
    r'<div class="controlcam"><h2>Old S3 camera</h2>.*?</div></div></section>',
    '</div></section>',
    s,
    count=1,
    flags=re.S,
)

# JS: only S9/new camera controls and one live tab.
s=s.replace("for(const id of ['newFrame','oldFrame'])","for(const id of ['newFrame'])")
s=s.replace("function refreshControls(){loadControls('new','new');loadControls('s3','old')}","function refreshControls(){loadControls('new','new')}")
s=re.sub(r"if\(t==='old'\)\{.*?\}",'',s,count=1,flags=re.S)
s=re.sub(r"if\(t==='s3Saved'\)\{.*?\}",'',s,count=1,flags=re.S)
s=s.replace("streams(t==='both')","streams(t==='live')")
s=s.replace("active==='both'","active==='live'")
s=s.replace("(k==='s9'?'S9+':'S3')","'S9+'")

# The active Security page must have zero S3 text/routes after this.
bad_rx=re.compile(r'(?i)(camera\.s3|\bs3\b|panel-old|panel-s3saved|oldcontrols|oldframe|camera=s3|data-tab="old"|data-tab="s3saved"|both cameras live)')
bad=[]
for i,line in enumerate(s.splitlines(),1):
    if bad_rx.search(line):
        bad.append(f"{i}:{line[:300]}")
if bad:
    raise SystemExit("S3 UI references remain in surveillance page:\n"+"\n".join(bad[:30]))

if 'data-tab="live">Live camera' not in s or 'id="panel-live"' not in s:
    raise SystemExit("single-camera live tab/panel missing")
if "loadControls('new','new')" not in s:
    raise SystemExit("new camera controls missing")
SURV.write_text(s,encoding="utf-8")

# Update the *current* Lovelace dashboard iframe URL inside the HA container,
# where /config is the mounted /opt/homeassistant/config directory.
new_url="/local/c720p-surveillance.html?v=V84_SINGLE_CAMERA_ONLY_20261007"
py=r'''
import json, pathlib, shutil, time
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
b=pathlib.Path("/config/.storage/lovelace.c720p_hub.before-v84-single-camera-"+time.strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
d=json.loads(p.read_text())
views=d["data"]["config"]["views"]
v=next(x for x in views if x.get("path")=="front-yard-security")
cards=v.get("cards") or []
if len(cards)!=1 or cards[0].get("type")!="iframe":
    raise SystemExit("unexpected security Lovelace shape")
cards[0]["url"]="/local/c720p-surveillance.html?v=V84_SINGLE_CAMERA_ONLY_20261007"
tmp=p.with_suffix(".tmp-v84")
tmp.write_text(json.dumps(d,separators=(",",":")))
tmp.replace(p)
print("LOVELACE_BACKUP="+str(b))
print("LOVELACE_URL="+cards[0]["url"])
'''
r=subprocess.run(["docker","exec","homeassistant","python3","-c",py],text=True,capture_output=True,timeout=30)
if r.returncode!=0:
    raise SystemExit("Lovelace update failed: "+r.stdout+" "+r.stderr)
print(r.stdout.strip())

# Restart HA so the storage dashboard cache is definitely reloaded.
rr=subprocess.run(["docker","restart","homeassistant"],text=True,capture_output=True,timeout=60)
if rr.returncode!=0:
    raise SystemExit("Home Assistant restart failed: "+rr.stdout+" "+rr.stderr)
print("HA_RESTART="+rr.stdout.strip())

# Wait for HA HTTP to return.
ready=False
for _ in range(45):
    p=subprocess.run(["bash","-lc","curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8123/"],text=True,capture_output=True)
    if p.stdout.strip() in {"200","302","401"}:
        ready=True
        break
    time.sleep(1)
if not ready:
    raise SystemExit("Home Assistant did not return after restart")

# Confirm the storage config contains the new cache key after restart.
check=subprocess.run(
    ["docker","exec","homeassistant","python3","-c",
     'import json;d=json.load(open("/config/.storage/lovelace.c720p_hub"));v=next(x for x in d["data"]["config"]["views"] if x.get("path")=="front-yard-security");print(v["cards"][0]["url"])'],
    text=True,capture_output=True,timeout=20,
)
if new_url not in check.stdout:
    raise SystemExit("Lovelace URL verification failed: "+check.stdout+" "+check.stderr)

# Refresh local kiosk too.
w=subprocess.run(
    ["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],
    text=True,capture_output=True,
).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("BACKUP="+str(BACK))
print("SURVEILLANCE_S3_UI_REFS=0")
print("LOVELACE_CACHE_KEY=V84_SINGLE_CAMERA_ONLY_20261007")
print("HA_HTTP_READY=true")
print("RESULT=REMOVE_S3_SECURITY_UI_V25_APPLIED")
