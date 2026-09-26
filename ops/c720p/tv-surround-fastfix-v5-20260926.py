from pathlib import Path
import subprocess, time, shutil, datetime, json, urllib.request, os, re

ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
base=Path("/home/jespern/c720p-home-hub")
www=Path("/opt/homeassistant/config/www")
guard=base/"bin/c720p-browsermetrics-guard.sh"
srv=base/"bin/ht-e6500-surround-server.py"
ui=www/"c720p-tv-surround.html"
row=www/"c720p-weather-row.html"

for p in (guard,srv,ui,row):
    if p.exists():
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
new_refresh='''async function refreshTV(){
  const r=await req("/grundig-tv/power-state","GET",2200);
  const st=r.ok&&r.data?String(r.data.state||"").toLowerCase():"unknown";
  S.tv=(st==="on"||st==="off")?st:"unknown"
}'''
s,n=re.subn(r'async function refreshTV\(\)\{.*?\n\}',new_refresh,s,count=1,flags=re.S)
if n!=1:
    raise SystemExit("refreshTV function not found")
s=s.replace('45000);','18000);',1)
s=s.replace('verifyState("tv",target,7,900)','verifyState("tv",target,6,500)',1)
s=s.replace('55000);','18000);',1)
s=s.replace('verifyState("hts",target,7,1100)','verifyState("hts",target,6,600)',1)
s=s.replace('setInterval(()=>refresh(true),5000);','setInterval(()=>refresh(true),2000);')
s=s.replace('C720P_TV_SURROUND_ACTIONS_V3_POLISHED','C720P_TV_SURROUND_ACTIONS_V4_FAST_STATE_SAFE')
ui.write_text(s,encoding="utf-8")

if row.exists():
    r=row.read_text(encoding="utf-8")
    r=re.sub(r'c720p-tv-surround\.html\?v=[^"\']+','c720p-tv-surround.html?v=fast-state-safe-20260926-v4',r)
    row.write_text(r,encoding="utf-8")

s=srv.read_text(encoding="utf-8")
pat=r'''\s*time\.sleep\(8\.0 if want_on else 3\.0\)
\s*checks = \[\]
\s*final = None
\s*confirmed = False
\s*for idx in range\(3\):
\s*final = receiver_present\(\)
\s*checks\.append\(final\)
\s*if bool\(final\.get\("present"\)\) == bool\(want_on\):
\s*confirmed = True
\s*break
\s*if idx < 2:
\s*time\.sleep\(2\.0\)'''
rep='''    checks = []
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
        time.sleep(0.65)'''
s,n1=re.subn(pat,rep,s,count=1)

pat2=r'''\s*time\.sleep\(10\.0 if want_on else 4\.0\)
\s*checks = \[\]
\s*after = None
\s*confirmed = False
\s*for idx in range\(5\):
\s*after = grundig_fast_power_state\(\)
\s*checks\.append\(after\)
\s*if after\.get\("state"\) == wanted:
\s*confirmed = True
\s*break
\s*if idx < 4:
\s*time\.sleep\(2\.0\)'''
rep2='''    checks = []
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
        time.sleep(0.55)'''
s,n2=re.subn(pat2,rep2,s,count=1)
if n1!=1 or n2!=1:
    raise SystemExit(f"backend wait replacements failed hts={n1} tv={n2}")
srv.write_text(s,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(srv)],check=True)
subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service"],check=True)
time.sleep(1)

print(subprocess.run([str(guard)],text=True,capture_output=True).stdout.strip())
print("SERVICE="+subprocess.run(["systemctl","--user","is-active","ht-e6500-surround.service"],text=True,capture_output=True).stdout.strip())
for path in ("/grundig-tv/power-state","/ht-e6500/power-state"):
    t=time.perf_counter()
    with urllib.request.urlopen("http://127.0.0.1:8789"+path,timeout=5) as resp:
        obj=json.load(resp)
    print(path,"state="+str(obj.get("state")),"ms=%.1f"%((time.perf_counter()-t)*1000))
u=ui.read_text(encoding="utf-8")
print("UI_V4="+str("C720P_TV_SURROUND_ACTIONS_V4_FAST_STATE_SAFE" in u).lower())
print("UI_POLL_2S="+str("setInterval(()=>refresh(true),2000);" in u).lower())
print("UI_HA_SHORTCUT_REMOVED="+str("const hs=tvHaState()" not in u).lower())
print("RESULT=TV_SURROUND_FASTFIX_V5_APPLIED")
