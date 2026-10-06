#!/usr/bin/env python3
from pathlib import Path
import datetime, re, shutil, subprocess, time

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
FILES=[
    WWW/"c720p-weather-row.html",
    WWW/"c720p-extra-row.html",
    WWW/"c720p-scenes-compact.html",
    WWW/"c720p-scenes-compact-v7b.html",
    WWW/"c720p-release/home-live-primary-v2.html",
]
OLD_LIVE=WWW/"c720p-release/home-live-s3-v1.html"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"remove-s3-live-entirely-v24-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

for p in FILES+[OLD_LIVE]:
    if p.exists():
        shutil.copy2(p,BACK/(p.name+".before"))

# 1) Remove S3 fallback from the home weather/security live preview.
p=WWW/"c720p-weather-row.html"
s=p.read_text(encoding="utf-8")
old=re.search(r"async function startLive\(\)\{.*?\}\s*function stopLive",s,re.S)
if not old:
    raise SystemExit("weather-row startLive block not found")
new='''async function startLive(){const img=document.getElementById('secLive'),badge=document.getElementById('secLiveBadge');if(!img)return;if(img.dataset.mode==='live'&&img.getAttribute('src'))return;img.dataset.mode='live';img.onerror=()=>{img.dataset.mode='offline';img.removeAttribute('src');if(badge)badge.textContent='Primary camera offline'};img.onload=()=>{if(badge&&img.dataset.mode==='live')badge.textContent='LIVE video · S9+'};try{const u=await C720PSecureRelay.url('/new/live.mjpg');img.src=u+'&live='+Date.now();if(badge)badge.textContent='LIVE video · S9+'}catch(e){img.onerror()}}
function stopLive'''
s=s[:old.start()]+new+s[old.end():]
# Explicitly forbid reintroduction in this active preview.
if re.search(r"(?i)/s3/live|camera\.s3|live video · old s3|dataset\.mode==='s3'",s):
    raise SystemExit("S3 live fallback still present in weather row")
p.write_text(s,encoding="utf-8")

# 2) Home live controls should refer only to S9+ / primary live.
for name in ("c720p-extra-row.html","c720p-scenes-compact.html","c720p-scenes-compact-v7b.html"):
    p=WWW/name
    if not p.exists():
        continue
    t=p.read_text(encoding="utf-8")
    t=t.replace('entity_id:"camera.s3"','entity_id:"camera.s9_direct"')
    t=t.replace("entity_id:'camera.s3'","entity_id:'camera.s9_direct'")
    t=t.replace("S3 camera","S9+ camera")
    t=t.replace("Live S3 camera","Live S9+ camera")
    t=t.replace('"camera.s3"','"camera.s9_direct"')
    t=t.replace("'camera.s3'","'camera.s9_direct'")
    # These hint-only values are not entity IDs.
    t=t.replace("?'camera.s3':'camera'","?'S9+ camera':'camera'")
    t=t.replace("?\"camera.s3\":\"camera\"","?\"S9+ camera\":\"camera\"")
    p.write_text(t,encoding="utf-8")

# 3) Primary live component remains primary-only.
p=WWW/"c720p-release/home-live-primary-v2.html"
if p.exists():
    t=p.read_text(encoding="utf-8")
    if re.search(r"(?i)/s3/live|camera\.s3|8791|live · s3|using s3|last s3",t):
        raise SystemExit("primary live component unexpectedly contains S3 live references")

# 4) Neutralize the obsolete served S3-live HTML. The release directory is not
# writable by the runner, so deleting the entry may be forbidden even though the
# file itself is owned by jespern. Replacing its content removes the feed entirely.
if OLD_LIVE.exists():
    try:
        OLD_LIVE.chmod(0o644)
    except Exception:
        pass
    OLD_LIVE.write_text("""<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Cache-Control" content="no-store"><title>Camera removed</title></head><body style="margin:0;background:#03070d;color:#d8e4ee;font:16px system-ui;display:grid;place-items:center;height:100vh"><div>S3 live camera removed.</div></body></html>\n""",encoding="utf-8")
    try:
        OLD_LIVE.chmod(0o444)
    except Exception:
        pass

# 5) Validate current served UI: no operational S3 live hooks in active home/live files.
patterns=re.compile(r"(?i)(camera\.s3|/s3/live|home-live-s3|live · s3|live s3 camera|live video · old s3|dataset\.mode=['\"]s3['\"]|8791/live\.mjpg)")
bad=[]
for p in FILES:
    if not p.exists():
        continue
    for i,line in enumerate(p.read_text(encoding="utf-8",errors="replace").splitlines(),1):
        if patterns.search(line):
            bad.append(f"{p}:{i}:{line[:240]}")
if bad:
    raise SystemExit("operational S3 live references remain:\n"+"\n".join(bad[:30]))
if OLD_LIVE.exists():
    tomb=OLD_LIVE.read_text(encoding="utf-8",errors="replace")
    if re.search(r"(?i)(camera\\.s3|/s3/live|8791/live|<img|<video|mjpg)",tomb):
        raise SystemExit("obsolete S3 live component was not neutralized")

# 6) Old S3 recorder/live service must stay stopped; do NOT disable historical clip data files.
subprocess.run(["systemctl","--user","stop","c720p-frontyard-security.service"],check=False)
# It is already disabled in the current system, but make that explicit so it cannot restart as a live source.
subprocess.run(["systemctl","--user","disable","c720p-frontyard-security.service"],check=False)

# Reload kiosk only; do not restart Home Assistant.
w=subprocess.run(
    ["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],
    text=True,capture_output=True,
).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)
time.sleep(2)

# Runtime/static verification.
checks=[]
checks.append(("old_live_component_neutralized",OLD_LIVE.exists() and "S3 live camera removed." in OLD_LIVE.read_text(encoding="utf-8",errors="replace")))
ss=subprocess.run(["bash","-lc","ss -ltn | grep -q ':8791 ' && echo yes || echo no"],text=True,capture_output=True).stdout.strip()
checks.append(("port_8791_listening",ss=="yes"))
svc=subprocess.run(["systemctl","--user","is-active","c720p-frontyard-security.service"],text=True,capture_output=True).stdout.strip()
enabled=subprocess.run(["systemctl","--user","is-enabled","c720p-frontyard-security.service"],text=True,capture_output=True).stdout.strip()
checks.append(("old_s3_service_active",svc=="active"))
checks.append(("old_s3_service_enabled",enabled=="enabled"))

print("BACKUP="+str(BACK))
for k,v in checks:
    print(f"{k}={str(v).lower()}")
print("OLD_S3_SERVICE_STATE="+svc)
print("OLD_S3_SERVICE_ENABLED="+enabled)
print("S3_LIVE_OPERATIONAL_REFS=0")
print("RESULT=REMOVE_S3_LIVE_ENTIRELY_V24_APPLIED")
