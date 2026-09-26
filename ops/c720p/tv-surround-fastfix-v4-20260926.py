from pathlib import Path
import subprocess, time, shutil, datetime, json, urllib.request, os

ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
base=Path("/home/jespern/c720p-home-hub")
www=Path("/opt/homeassistant/config/www")
guard=base/"bin/c720p-browsermetrics-guard.sh"
srv=base/"bin/ht-e6500-surround-server.py"
ui=www/"c720p-tv-surround.html"

for p in (guard,srv,ui):
    shutil.copy2(p, str(p)+f".backup-tvfast-{ts}")

guard.write_text("""#!/bin/bash
set -u
BM=/home/jespern/.config/c720p-kiosk-chromium/BrowserMetrics
raw_sz=$(du -sm "$BM" 2>/dev/null | awk '{print $1}' | head -1)
raw_free=$(df -BM / 2>/dev/null | awk 'NR==2{gsub(/M/,"",$4);print $4}')
case "$raw_sz" in
  ""|*[!0-9]*) SZ=0 ;;
  *) SZ=$raw_sz ;;
esac
case "$raw_free" in
  ""|*[!0-9]*)
    echo "BROWSERMETRICS_GUARD=SKIP_INVALID_FREE raw_free=$raw_free size_mb=$SZ"
    exit 0
    ;;
  *) FREE=$raw_free ;;
esac
if [ "$SZ" -gt 64 ] || [ "$FREE" -lt 500 ]; then
  find "$BM" -mindepth 1 -type f -delete 2>/dev/null || true
  echo "BROWSERMETRICS_GUARD=CLEANED size_mb=$SZ free_mb=$FREE kiosk_restart=false"
else
  echo "BROWSERMETRICS_GUARD=HEALTHY size_mb=$SZ free_mb=$FREE kiosk_restart=false"
fi
""", encoding="utf-8")
os.chmod(guard,0o755)

s=ui.read_text(encoding="utf-8")
old='''async function refreshTV(){
  const hs=tvHaState();
  if(hs==="on"){S.tv="on";return}
  const r=await req("/grundig-tv/power-state","GET",3500);
  const s=r.ok&&r.data?String(r.data.state||"").toLowerCase():"unknown";
  if(s==="on"||s==="off"){S.tv=s;return}
  S.tv=hs==="off"?"off":"unknown"
}'''
new='''async function refreshTV(){
  const r=await req("/grundig-tv/power-state","GET",2200);
  const s=r.ok&&r.data?String(r.data.state||"").toLowerCase():"unknown";
  S.tv=(s==="on"||s==="off")?s:"unknown"
}'''
if old not in s:
    raise SystemExit("refreshTV block not found")
s=s.replace(old,new,1)
repls=[
('const r=await req("/grundig-tv/"+target,"POST",45000);','const r=await req("/grundig-tv/"+target,"POST",18000);'),
('const confirmed=await verifyState("tv",target,7,900);','const confirmed=await verifyState("tv",target,6,500);'),
('const r=await req("/ht-e6500/ensure-"+target,"POST",55000);','const r=await req("/ht-e6500/ensure-"+target,"POST",18000);'),
('const confirmed=await verifyState("hts",target,7,1100);','const confirmed=await verifyState("hts",target,6,600);'),
('setInterval(()=>refresh(true),5000);','setInterval(()=>refresh(true),2000);'),
('data-controls-version="C720P_TV_SURROUND_ACTIONS_V3_POLISHED"','data-controls-version="C720P_TV_SURROUND_ACTIONS_V4_FAST_STATE_SAFE"')
]
for a,b in repls:
    if a not in s:
        raise SystemExit("UI marker missing: "+a)
    s=s.replace(a,b,1)
ui.write_text(s,encoding="utf-8")

s=srv.read_text(encoding="utf-8")
old='''    time.sleep(8.0 if want_on else 3.0)
    checks = []
    final = None
    confirmed = False
    for idx in range(3):
        final = receiver_present()
        checks.append(final)
        if bool(final.get("present")) == bool(want_on):
            confirmed = True
            break
        if idx < 2:
            time.sleep(2.0)
'''
new='''    checks = []
    final = None
    confirmed = False
    deadline = time.monotonic() + (8.0 if want_on else 4.0)
    while True:
        final = receiver_present()
        checks.append(final)
        if bool(final.get("present")) == bool(want_on):
            confirmed = True
            break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.65)
'''
if old not in s:
    raise SystemExit("HTS wait block not found")
s=s.replace(old,new,1)

old='''    time.sleep(10.0 if want_on else 4.0)
    checks = []
    after = None
    confirmed = False
    for idx in range(5):
        after = grundig_fast_power_state()
        checks.append(after)
        if after.get("state") == wanted:
            confirmed = True
            break
        if idx < 4:
            time.sleep(2.0)
'''
new='''    checks = []
    after = None
    confirmed = False
    deadline = time.monotonic() + (12.0 if want_on else 6.0)
    while True:
        after = grundig_fast_power_state()
        checks.append(after)
        if after.get("state") == wanted:
            confirmed = True
            break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.55)
'''
if old not in s:
    raise SystemExit("TV wait block not found")
s=s.replace(old,new,1)
srv.write_text(s,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(srv)],check=True)
subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service"],check=True)
time.sleep(1)
print(subprocess.run([str(guard)],text=True,capture_output=True).stdout.strip())
print("SERVICE="+subprocess.run(["systemctl","--user","is-active","ht-e6500-surround.service"],text=True,capture_output=True).stdout.strip())

for path in ("/grundig-tv/power-state","/ht-e6500/power-state"):
    t=time.perf_counter()
    with urllib.request.urlopen("http://127.0.0.1:8789"+path,timeout=5) as r:
        obj=json.load(r)
    print(path,"state="+str(obj.get("state")),"ms=%.1f"%((time.perf_counter()-t)*1000))

u=ui.read_text(encoding="utf-8")
print("UI_V4="+str("C720P_TV_SURROUND_ACTIONS_V4_FAST_STATE_SAFE" in u).lower())
print("UI_POLL_2S="+str("setInterval(()=>refresh(true),2000);" in u).lower())
print("RESULT=TV_SURROUND_FASTFIX_V4_APPLIED")
