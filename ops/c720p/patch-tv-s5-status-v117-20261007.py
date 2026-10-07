#!/usr/bin/env python3
from pathlib import Path
import datetime,re,shutil,subprocess,time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
SERVER=BASE/"bin/ht-e6500-surround-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround-v21.html")
ROW=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"tv-s5-status-v117-{STAMP}"
BACK.mkdir(parents=True,exist_ok=False)
for p in (SERVER,UI,ROW): shutil.copy2(p,BACK/(p.name+".before"))

s=SERVER.read_text(encoding="utf-8")
marker="C720P_S5_LAN_STATUS_V117"
if marker not in s:
    anchor="def probe_s5_http(host, timeout=4.0):\n"
    helper='''# C720P_S5_LAN_STATUS_V117
def s5_lan_presence():
    """Fast, non-invasive neighbor-table evidence for the configured S5 host."""
    r = run(["ip", "neigh", "show", str(S5_HOST)], timeout=2)
    line = (r.get("stdout") or "").strip()
    upper = line.upper()
    state = "unknown"
    for candidate in ("REACHABLE","STALE","DELAY","PROBE","PERMANENT","FAILED","INCOMPLETE","NOARP"):
        if candidate in upper.split():
            state = candidate.lower()
            break
    present = bool(line) and state not in {"failed","incomplete"}
    mac = ""
    parts = line.split()
    if "lladdr" in parts:
        try: mac = parts[parts.index("lladdr")+1].lower()
        except Exception: pass
    return {
        "present": present,
        "host": str(S5_HOST),
        "mac": mac or None,
        "neighbor_state": state,
        "evidence": line,
        "source": "ip_neigh",
    }


'''
    if anchor not in s: raise SystemExit("server probe anchor missing")
    s=s.replace(anchor,helper+anchor,1)

    old='''            return respond(self, 200, {"ok": True, "service": "ht-e6500-surround", "target": active_target, "configured_target": TARGET, "s5_transport": ident.get("transport") or ("adb" if ok else "unavailable"), "s5_connected": ok, "s5_http": s5_http_health(), "adb_devices": devices})'''
    new='''            return respond(self, 200, {"ok": True, "service": "ht-e6500-surround", "target": active_target, "configured_target": TARGET, "s5_transport": ident.get("transport") or ("adb" if ok else "unavailable"), "s5_connected": ok, "s5_http": s5_http_health(), "s5_lan": s5_lan_presence(), "usb_auto_recovery": True, "adb_devices": devices})'''
    if old not in s: raise SystemExit("server health response anchor missing")
    s=s.replace(old,new,1)
SERVER.write_text(s,encoding="utf-8")
subprocess.run(["python3","-m","py_compile",str(SERVER)],check=True)

u=UI.read_text(encoding="utf-8")
u=u.replace("C720P_TV_SURROUND_ACTIONS_V16_TV_INDEPENDENT_S5_NETWORK_ADB",
            "C720P_TV_SURROUND_ACTIONS_V17_S5_WIFI_BRIDGE_STATUS")
old='''  irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
  mediaReady=!!(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present&&m.audio_sink_default);
  pill(e.tvP,"TV",tvState);
  pill(e.htsP,"HTS",htsState);
  if(irReady)pill(e.irP,"IR",true);
  else{e.irP.textContent="IR Offline";e.irP.className="pill bad"}
  e.tv.classList.toggle("on",tvState===true);
  e.hts.classList.toggle("on",htsState===true);
  label(e.tv,tvState===true?"Turn TV Off":"Turn TV On","Grundig Wi-Fi control");
  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",irReady?"Samsung HT-E6500":"S5 Offline · Tap to Retry");
  e.macro.classList.toggle("on",mediaReady);
  if(!irReady){
    label(e.up,"Volume +","S5 Offline · Tap to Retry");
    label(e.down,"Volume −","S5 Offline · Tap to Retry");
  }'''
new='''  irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
  const s5Lan=!!(h.s5_lan&&h.s5_lan.present);
  mediaReady=!!(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present&&m.audio_sink_default);
  pill(e.tvP,"TV",tvState);
  pill(e.htsP,"HTS",htsState);
  if(irReady)pill(e.irP,"IR",true);
  else if(s5Lan){e.irP.textContent="IR Bridge Stopped";e.irP.className="pill unknown"}
  else{e.irP.textContent="IR Offline";e.irP.className="pill bad"}
  e.tv.classList.toggle("on",tvState===true);
  e.hts.classList.toggle("on",htsState===true);
  label(e.tv,tvState===true?"Turn TV Off":"Turn TV On","Grundig Wi-Fi control");
  const s5Problem=s5Lan?"S5 on Wi-Fi · bridge stopped · USB auto-recovery armed":"S5 unavailable · USB auto-recovery armed";
  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",irReady?"Samsung HT-E6500":s5Problem);
  e.macro.classList.toggle("on",mediaReady);
  if(!irReady){
    label(e.up,"Volume +",s5Problem);
    label(e.down,"Volume −",s5Problem);
  }'''
if old not in u: raise SystemExit("UI refresh status anchor missing")
u=u.replace(old,new,1)
u=u.replace('''  }else if(!irReady){
    label(e.macro,"Connect Surround","TV → HDMI 3 → Bluetooth · S5 IR auto-retry");
    status("TV Ready · S5 IR Offline · HTS Controls Will Retry IR");
  }else{''',
'''  }else if(!irReady){
    label(e.macro,"Connect Surround","TV → HDMI 3 → Bluetooth · S5 bridge auto-recovery");
    status(s5Lan?"TV Ready · S5 On Wi-Fi · IR Bridge Stopped · USB Recovery Armed":"TV Ready · S5 Unavailable · USB Recovery Armed");
  }else{''',1)
UI.write_text(u,encoding="utf-8")

r=ROW.read_text(encoding="utf-8")
r,n=re.subn(r'c720p-tv-surround-v21\.html(?:\?v=[^"\']*)?',
            'c720p-tv-surround-v21.html?v=S5_STATUS_V117_20261007',r)
if n<1: raise SystemExit("weather-row iframe anchor missing")
ROW.write_text(r,encoding="utf-8")

subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service"],check=True,timeout=20)
time.sleep(1)
probe=subprocess.run(["bash","-lc","curl -sS --max-time 10 http://127.0.0.1:8789/health"],capture_output=True,text=True,timeout=15)

w=subprocess.run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],capture_output=True,text=True).stdout.strip()
if w: subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("TV_S5_STATUS_V117=OK")
print("BACKUP="+str(BACK))
print("HEALTH="+probe.stdout[:7000].replace("\n"," | "))
print("UI_MARKER="+str("C720P_TV_SURROUND_ACTIONS_V17_S5_WIFI_BRIDGE_STATUS" in UI.read_text()))
