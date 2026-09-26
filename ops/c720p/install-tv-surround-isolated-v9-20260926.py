#!/usr/bin/env python3
from pathlib import Path
import datetime,json,os,re,shutil,subprocess,time,urllib.request,urllib.error

BASE=Path("/home/jespern/c720p-home-hub")
WWW=Path("/opt/homeassistant/config/www")
BIN=BASE/"bin"
UNIT=Path.home()/".config/systemd/user"
CTRL=BIN/"c720p-tv-fast-controller.py"
UI=WWW/"c720p-tv-surround.html"
ROW=WWW/"c720p-weather-row.html"
GUARD=BIN/"c720p-browsermetrics-guard.sh"
SRC="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/c720p-tv-fast-controller-v9.py"
ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
out=[]

def run(cmd,timeout=15):
    p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
    out.append("$ "+" ".join(cmd)+"\n"+(p.stdout or "")[-2500:]+(p.stderr or "")[-1500:])
    return p

def req(url,method="GET",timeout=8):
    t=time.perf_counter()
    r=urllib.request.Request(url,method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            return x.status,json.load(x),round((time.perf_counter()-t)*1000)
    except urllib.error.HTTPError as e:
        try:d=json.loads(e.read().decode())
        except:d={"error":str(e)}
        return e.code,d,round((time.perf_counter()-t)*1000)
    except Exception as e:
        return 0,{"error":type(e).__name__+":"+str(e)[:240]},round((time.perf_counter()-t)*1000)

def ha_restarts():
    p=subprocess.run(["sudo","-n","docker","inspect","homeassistant","--format","{{.RestartCount}}"],text=True,capture_output=True)
    return (p.stdout or "").strip() or "unknown"

def kiosk_pid():
    p=subprocess.run(["systemctl","--user","show","c720p-home-hub-kiosk.service","-p","MainPID","--value"],text=True,capture_output=True)
    return (p.stdout or "").strip() or "unknown"

for p in (CTRL,UI,ROW,GUARD,UNIT/"c720p-tv-fast-controller.service"):
    if p.exists(): shutil.copy2(p,str(p)+f".backup-tv-v9-{ts}")

urllib.request.urlretrieve(SRC,CTRL)
os.chmod(CTRL,0o755)
subprocess.run(["python3","-m","py_compile",str(CTRL)],check=True)

UNIT.mkdir(parents=True,exist_ok=True)
(UNIT/"c720p-tv-fast-controller.service").write_text("""[Unit]
Description=C720P isolated TV and surround fast controller
After=network-online.target ht-e6500-surround.service c720p-bluetooth-helper.service
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-tv-fast-controller.py
Restart=on-failure
RestartSec=1
Nice=-5
[Install]
WantedBy=default.target
""",encoding="utf-8")

GUARD.write_text("""#!/bin/bash
set -u
BM=/home/jespern/.config/c720p-kiosk-chromium/BrowserMetrics
raw_sz=$(du -sm "$BM" 2>/dev/null | awk '{print $1}' | head -1)
raw_free=$(df -BM / 2>/dev/null | awk 'NR==2{gsub(/M/,"",$4);print $4}')
case "$raw_sz" in ""|*[!0-9]*) SZ=0;; *) SZ=$raw_sz;; esac
case "$raw_free" in ""|*[!0-9]*) echo "BROWSERMETRICS_GUARD=SKIP"; exit 0;; *) FREE=$raw_free;; esac
if [ "$SZ" -gt 64 ] || [ "$FREE" -lt 500 ]; then
 find "$BM" -mindepth 1 -type f -delete 2>/dev/null || true
 echo "BROWSERMETRICS_GUARD=CLEANED kiosk_restart=false ha_restart=false"
else
 echo "BROWSERMETRICS_GUARD=HEALTHY kiosk_restart=false ha_restart=false"
fi
""",encoding="utf-8")
os.chmod(GUARD,0o755)

html=r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store">
<style>
:root{--bg:#080b10;--edge:#273445;--text:#f5f7fa;--muted:#91a0b4;--good:#62e6bd;--warn:#ffc45b;--bad:#ff6b77}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}
.card{height:100%;padding:8px;border-radius:16px;background:linear-gradient(160deg,#111925,#080b10 68%);border:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;gap:7px}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}.title{font-weight:950;font-size:15px}.state{font-size:10px;color:var(--muted);white-space:nowrap}.state.good{color:var(--good)}.state.warn{color:var(--warn)}.state.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;min-height:0;flex:1}
button{border:1px solid var(--edge);border-radius:11px;background:linear-gradient(180deg,#1a2532,#111923);color:var(--text);font-weight:850;font-size:11px;padding:7px 5px;min-height:34px;cursor:pointer;transition:transform .08s,border-color .15s}
button:active{transform:scale(.975)}button[disabled]{opacity:.48;cursor:not-allowed}button.primary{grid-column:1/-1;background:linear-gradient(180deg,#17332e,#10251f);border-color:#275c4d;color:#dffff5}button.busy{border-color:var(--warn);color:#ffe8b6}
.foot{display:flex;justify-content:space-between;gap:5px;font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden}.foot span{overflow:hidden;text-overflow:ellipsis}
</style></head><body><div class="card" data-controls-version="C720P_TV_SURROUND_V9_ISOLATED_FAST">
<div class="head"><div class="title">TV & surround</div><div id="summary" class="state">checking…</div></div>
<div class="grid"><button id="tv">TV checking…</button><button id="hts">HTS checking…</button><button id="down">Volume −</button><button id="up">Volume +</button><button id="macro" class="primary">TV → HDMI 3 → Bluetooth</button><button id="spotify">Spotify</button><button id="refresh">Refresh state</button></div>
<div class="foot"><span id="bt">Bluetooth: checking</span><span id="speed"></span></div></div>
<script>
const BASE="http://127.0.0.1:8792",E=id=>document.getElementById(id);let state=null,refreshing=false,macroWatch=null;
async function req(path,method="GET",timeout=20000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout),a=performance.now();try{const r=await fetch(BASE+path,{method,cache:"no-store",signal:c.signal});let d={};try{d=await r.json()}catch{}return{ok:r.ok,status:r.status,data:d,ms:Math.round(performance.now()-a)}}catch(e){return{ok:false,status:0,data:{error:String(e)},ms:Math.round(performance.now()-a)}}finally{clearTimeout(t)}}
function render(){const tv=state?.tv||"unknown",ht=state?.hts||"unknown",m=state?.macro||{};E("tv").textContent=tv==="on"?"Turn TV off":tv==="off"?"Turn TV on":"TV state unknown";E("hts").textContent=ht==="on"?"Turn HTS off":ht==="off"?"Turn HTS on":"HTS state unknown";E("tv").disabled=!(tv==="on"||tv==="off");E("hts").disabled=!(ht==="on"||ht==="off");E("bt").textContent="Bluetooth: "+(state?.bluetooth_connected?"connected":"not connected");const running=m.state==="running";E("macro").classList.toggle("busy",running);E("macro").textContent=running?"Connecting…":"TV → HDMI 3 → Bluetooth";E("summary").textContent="TV "+tv+" · HTS "+ht;E("summary").className="state "+((tv==="unknown"||ht==="unknown")?"warn":"good");const tm=state?.timings_ms||{};E("speed").textContent="state "+Math.max(tm.tv_power||0,tm.tv_status||0,tm.hts||0,tm.bt||0)+" ms"}
async function refresh(){if(refreshing)return;refreshing=true;const r=await req("/state","GET",3500);if(r.ok){state=r.data;render()}else{E("summary").textContent="controller unavailable";E("summary").className="state bad"}refreshing=false}
async function action(btn,path,timeout=20000){if(btn.disabled)return;btn.disabled=true;btn.classList.add("busy");const r=await req(path,"POST",timeout);btn.classList.remove("busy");btn.disabled=false;await refresh();return r}
E("tv").onclick=()=>action(E("tv"),"/tv/toggle",16000);E("hts").onclick=()=>action(E("hts"),"/hts/toggle",16000);E("down").onclick=()=>action(E("down"),"/volume/down",5500);E("up").onclick=()=>action(E("up"),"/volume/up",5500);E("spotify").onclick=()=>action(E("spotify"),"/spotify/open",9000);E("refresh").onclick=refresh;
E("macro").onclick=async()=>{const r=await req("/macro/start","POST",2500);if(r.ok){await refresh();clearInterval(macroWatch);macroWatch=setInterval(async()=>{await refresh();if(state?.macro?.state!=="running"){clearInterval(macroWatch);macroWatch=null}},500)}};
refresh();setInterval(refresh,1500);
</script></body></html>'''
UI.write_text(html,encoding="utf-8")

if ROW.exists():
    s=ROW.read_text(encoding="utf-8")
    s=re.sub(r'c720p-tv-surround\.html\?v=[^"\']+',"c720p-tv-surround.html?v=isolated-fast-v9-20260926",s)
    ROW.write_text(s,encoding="utf-8")

hb=ha_restarts(); kb=kiosk_pid()
run(["systemctl","--user","daemon-reload"],10)
run(["systemctl","--user","enable","--now","c720p-tv-fast-controller.service"],15)
time.sleep(.8)
hc,h,hm=req("http://127.0.0.1:8792/health")
sc,st,sm=req("http://127.0.0.1:8792/state")
out += [f"HEALTH={hc} {h} {hm}ms",f"STATE={sc} tv={st.get('tv')} hts={st.get('hts')} bt={st.get('bluetooth_connected')} timings={st.get('timings_ms')} total={sm}ms"]

mc,mo,mm=req("http://127.0.0.1:8792/macro/start","POST",4)
out.append(f"MACRO_START={mc} {mo} {mm}ms")
deadline=time.monotonic()+42; last={}
while time.monotonic()<deadline:
    _,last,_=req("http://127.0.0.1:8792/state",timeout=4)
    if (last.get("macro") or {}).get("state") not in ("running",None): break
    time.sleep(.5)

ha=ha_restarts(); ka=kiosk_pid()
out.append("MACRO_FINAL="+json.dumps(last.get("macro") or {},separators=(",",":"))[-9000:])
out += [f"HA_RESTART_COUNT_BEFORE={hb}",f"HA_RESTART_COUNT_AFTER={ha}",f"KIOSK_PID_BEFORE={kb}",f"KIOSK_PID_AFTER={ka}","NO_HA_RESTART="+str(hb==ha).lower(),"NO_KIOSK_RESTART="+str(kb==ka).lower(),"UI_ISOLATED="+str("127.0.0.1:8792" in UI.read_text()).lower(),"UI_RECOVER_FREE="+str("/recover" not in UI.read_text()).lower(),"RESULT=C720P_TV_SURROUND_V9_INSTALLED"]
diag="\n".join(out)[-46000:]; print(diag)
try:
    token=(Path.home()/".config/c720p-agent/security-token").read_text().strip()
    q=urllib.request.Request("https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/ops-c720p-diag-ingest-v1",data=diag.encode(),method="POST",headers={"content-type":"text/plain; charset=utf-8","x-c720p-token":token})
    with urllib.request.urlopen(q,timeout=15) as r: print("DIAG_INGEST="+str(r.status))
except Exception as e: print("DIAG_INGEST_ERR="+type(e).__name__+":"+str(e)[:200])
