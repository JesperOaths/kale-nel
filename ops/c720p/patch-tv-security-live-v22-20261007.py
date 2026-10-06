#!/usr/bin/env python3
from pathlib import Path
import datetime, re, shutil, subprocess, time, urllib.request, json

HOME = Path("/home/jespern")
WWW = Path("/opt/homeassistant/config/www")
UI = WWW / "c720p-tv-surround-v21.html"
ROW = WWW / "c720p-weather-row.html"
LIVE = WWW / "c720p-release/home-live-primary-v2.html"
STAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK = HOME / "c720p-backups" / f"tv-security-live-v22-{STAMP}"
BACK.mkdir(parents=True, exist_ok=True)

for p in (UI, ROW, LIVE):
    if not p.exists():
        raise SystemExit(f"required file missing: {p}")
    shutil.copy2(p, BACK / (p.name + ".before"))

# ---- TV + surround: preserve layout and the verified Grundig Wi-Fi path. ----
s = UI.read_text(encoding="utf-8")
s = s.replace(
    "C720P_TV_SURROUND_ACTIONS_V13_IR_COLDSTART_RESTORED",
    "C720P_TV_SURROUND_ACTIONS_V14_S5_SELFHEAL_PIPELINE_FALLTHROUGH",
)

ensure_ir = r'''async function ensureIR(){
  if(irReady)return true;
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    status("Finding S5 IR bridge"+(attempt>1?" · retry":"")+"…");
    try{
      await req(8789,"/s5/reconnect","POST",26000);
    }catch(err){lastError=err}
    await wait(700);
    try{
      const h=await req(8789,"/health","GET",10000);
      irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
      if(irReady){
        pill(e.irP,"IR",true);
        status("S5 IR bridge ready","ok");
        return true;
      }
    }catch(err){lastError=err}
  }
  irReady=false;
  e.irP.textContent="IR OFFLINE";
  e.irP.className="pill unknown";
  throw new Error("S5 IR bridge unavailable"+(lastError?": "+String(lastError?.message||lastError):""));
}
'''
a = s.find("async function ensureIR(){")
b = s.find("\ne.tv.onclick=", a)
if a < 0 or b < 0:
    raise SystemExit("ensureIR block not found in active TV/surround card")
s = s[:a] + ensure_ir + s[b:]

old_macro = '''    if(!mediaReady)await ensureIR();
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
new_macro = '''    if(!mediaReady){
      try{await ensureIR()}
      catch(err){status("S5 IR bridge offline · trying verified Bluetooth surround path…")}
    }
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
if old_macro in s:
    s = s.replace(old_macro, new_macro, 1)
elif "trying verified Bluetooth surround path" not in s:
    raise SystemExit("surround macro preflight block not found")
UI.write_text(s, encoding="utf-8")

# Cache bust only the nested TV/surround card URL.
r = ROW.read_text(encoding="utf-8")
r, n = re.subn(
    r'c720p-tv-surround-v21\.html(?:\?v=[^"\']*)?',
    'c720p-tv-surround-v21.html?v=BUTTONS_V22_SELFHEAL_20261007',
    r,
)
if n < 1:
    raise SystemExit("active TV/surround iframe reference not found")
ROW.write_text(r, encoding="utf-8")

# ---- Home live camera component: primary/S9+ only, no S3 fallback. ----
x = LIVE.read_text(encoding="utf-8")
x = x.replace(
    "C720P_HOME_LIVE_PRIMARY_V2_NEW_CAMERA_WITH_S3_FALLBACK",
    "C720P_HOME_LIVE_PRIMARY_V3_PRIMARY_ONLY_NO_S3",
)
# Remove the explicit fallback constants, if still present.
x = re.sub(
    r'^const FALLBACK_HEALTH=.*?;\s*$',
    '',
    x,
    count=1,
    flags=re.M,
)
x = x.replace("v60-primary-new-fallback-s3", "v61-primary-new-only-no-s3")

# Replace source-selection plumbing without touching the visual shell.
a = x.find("async function getJson(")
b = x.find("function primaryHealthy", a)
if a < 0 or b < 0:
    raise SystemExit("live getJson/primaryHealthy boundary not found")
get_json = '''async function getJson(_url){const c=new AbortController(),t=setTimeout(()=>c.abort(),1800);try{const r=await C720PSecureRelay.fetch('/new/health.json?t='+Date.now(),{cache:'no-store',signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}}\n'''
x = x[:a] + get_json + x[b:]

a = x.find("function fallbackHealthy(")
if a >= 0:
    b = x.find("async function setSource", a)
    if b < 0:
        raise SystemExit("live fallbackHealthy/setSource boundary not found")
    x = x[:a] + x[b:]

a = x.find("async function setSource(")
b = x.find("async function selectSource", a)
if a < 0 or b < 0:
    raise SystemExit("live setSource/selectSource boundary not found")
set_source = '''async function setSource(_kind,_url,badge,msg){if(activeSource==="primary"&&cam.getAttribute("src"))return;activeSource="primary";cam.removeAttribute("src");badgeBox.textContent=badge;statusBox.textContent=msg||"";statusBox.classList.toggle("show",!!msg);try{const u=await C720PSecureRelay.url('/new/live.mjpg');cam.src=u+(u.includes('?')?'&':'?')+'home='+Date.now()}catch(e){statusBox.textContent='Camera authorization unavailable';statusBox.classList.add('show')}}\n'''
x = x[:a] + set_source + x[b:]

a = x.find("async function selectSource(")
b = x.find("function startCamera", a)
if a < 0 or b < 0:
    raise SystemExit("live selectSource/startCamera boundary not found")
select_source = '''async function selectSource(){if(!isOn())return;const g=generation;let p=null;try{p=await getJson(PRIMARY_HEALTH)}catch(e){}if(g!==generation||!isOn())return;if(primaryHealthy(p)){await setSource("primary",PRIMARY_STREAM,"Live · New camera","");return}activeSource="";try{cam.removeAttribute("src")}catch(e){}badgeBox.textContent="Live · New camera";statusBox.textContent="Primary camera offline";statusBox.classList.add("show")}\n'''
x = x[:a] + select_source + x[b:]
x = x.replace(
    "Primary stream failed · selecting fallback",
    "Primary stream unavailable · retrying",
)
x = x.replace(
    "Camera stream unavailable · retrying",
    "Primary camera unavailable · retrying",
)

# The primary live component itself should now contain no S3/fallback route.
if re.search(r'(?i)(fallback_health|fallback_stream|/s3/|camera\.s3|8791|live · s3|last s3|using s3)', x):
    hits = [line for line in x.splitlines() if re.search(r'(?i)(fallback_health|fallback_stream|/s3/|camera\.s3|8791|live · s3|last s3|using s3)', line)]
    raise SystemExit("S3 references remain in primary live component: " + " | ".join(hits[:6]))
LIVE.write_text(x, encoding="utf-8")

# Syntax/contract checks on the touched HTML text.
u = UI.read_text(encoding="utf-8")
row = ROW.read_text(encoding="utf-8")
live = LIVE.read_text(encoding="utf-8")
assert "C720P_TV_SURROUND_ACTIONS_V14_S5_SELFHEAL_PIPELINE_FALLTHROUGH" in u
assert "for(let attempt=1;attempt<=2;attempt++)" in u
assert "trying verified Bluetooth surround path" in u
assert "BUTTONS_V22_SELFHEAL_20261007" in row
assert "C720P_HOME_LIVE_PRIMARY_V3_PRIMARY_ONLY_NO_S3" in live
assert "/new/live.mjpg" in live
assert not re.search(r'(?i)(fallback_health|fallback_stream|/s3/|camera\.s3|8791|live · s3|last s3|using s3)', live)

# Ensure services are alive; do not restart Home Assistant or kiosk.
for service in ("ht-e6500-surround.service", "c720p-bluetooth-helper.service"):
    subprocess.run(["systemctl", "--user", "restart", service], check=False)
time.sleep(2)

def get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as z:
            return z.status, z.read().decode("utf-8", "replace")
    except Exception as exc:
        return 0, repr(exc)

health_code, health = get("http://127.0.0.1:8789/health", 12)
state_code, state = get("http://127.0.0.1:8789/grundig-tv/power-state", 12)

# Reload the existing kiosk page without changing route/layout.
w = subprocess.run(
    ["bash", "-lc", "DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],
    text=True, capture_output=True
).stdout.strip()
if w:
    subprocess.run(["bash", "-lc", f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"], check=False)

print("BACKUP=" + str(BACK))
print("TV_UI_MARKER=" + str("C720P_TV_SURROUND_ACTIONS_V14_S5_SELFHEAL_PIPELINE_FALLTHROUGH" in u).lower())
print("TV_CARD_CACHE=" + str("BUTTONS_V22_SELFHEAL_20261007" in row).lower())
print("HOME_LIVE_S3_FREE=" + str(not bool(re.search(r'(?i)(/s3/|camera\.s3|8791|live · s3|last s3|using s3)', live))).lower())
print("HTS_HEALTH_HTTP=" + str(health_code))
print("HTS_HEALTH=" + health[:1200].replace("\n", " "))
print("TV_STATE_HTTP=" + str(state_code))
print("TV_STATE=" + state[:1000].replace("\n", " "))
print("RESULT=TV_SECURITY_LIVE_V22_APPLIED")
