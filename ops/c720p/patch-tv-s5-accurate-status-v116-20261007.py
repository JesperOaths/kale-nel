#!/usr/bin/env python3
from pathlib import Path
import datetime,re,shutil,subprocess,time,json,urllib.request

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
SERVER=BASE/"bin/ht-e6500-surround-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround-v21.html")
ROW=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"tv-s5-accurate-status-v116-{STAMP}"
BACK.mkdir(parents=True,exist_ok=False)
for p in (SERVER,UI,ROW): shutil.copy2(p,BACK/(p.name+".before"))

s=SERVER.read_text(encoding="utf-8")
MARK="C720P_S5_REACHABILITY_STATUS_V116"
if MARK not in s:
    anchor='def probe_s5_http(host, timeout=4.0):\n'
    fn=r'''# C720P_S5_REACHABILITY_STATUS_V116
_S5_REACH_CACHE={"host":"","at":0.0,"reachable":False,"source":"none","neighbor":""}
def s5_host_reachability():
    now=time.monotonic()
    cached=_S5_REACH_CACHE
    if cached.get("host")==S5_HOST and now-float(cached.get("at") or 0)<12.0:
        return dict(cached)
    neighbor=run(["ip","neigh","show",S5_HOST],timeout=1)
    line=(neighbor.get("stdout") or "").strip()
    upper=line.upper()
    if any((" "+state) in upper for state in ("REACHABLE","DELAY","PROBE","PERMANENT")):
        reachable=True;source="neighbor"
    else:
        ping=run(["ping","-c","1","-W","1",S5_HOST],timeout=1.4)
        reachable=bool(ping.get("ok"))
        source="icmp" if reachable else "unreachable"
    cached.update(host=S5_HOST,at=now,reachable=reachable,source=source,neighbor=line[:240])
    return dict(cached)

'''
    if anchor not in s: raise SystemExit("probe_s5_http anchor missing")
    s=s.replace(anchor,fn+anchor,1)

    old='''            return respond(self, 200, {"ok": True, "service": "ht-e6500-surround", "target": active_target, "configured_target": TARGET, "s5_transport": ident.get("transport") or ("adb" if ok else "unavailable"), "s5_connected": ok, "s5_http": s5_http_health(), "adb_devices": devices})'''
    new='''            http = s5_http_health()
            reach = s5_host_reachability()
            recovery_state = "ready" if (ok or http.get("ok")) else ("host_online_control_services_down" if reach.get("reachable") else "host_unreachable")
            return respond(self, 200, {"ok": True, "service": "ht-e6500-surround", "target": active_target, "configured_target": TARGET, "s5_transport": ident.get("transport") or ("adb" if ok else "unavailable"), "s5_connected": ok, "s5_http": http, "s5_host_reachable": bool(reach.get("reachable")), "s5_host_reachability": reach, "s5_recovery_state": recovery_state, "adb_devices": devices})'''
    if old not in s: raise SystemExit("health response anchor missing")
    s=s.replace(old,new,1)
SERVER.write_text(s,encoding="utf-8")

u=UI.read_text(encoding="utf-8")
u=u.replace("C720P_TV_SURROUND_ACTIONS_V16_TV_INDEPENDENT_S5_NETWORK_ADB",
            "C720P_TV_SURROUND_ACTIONS_V17_S5_WIFI_ADB_STATUS")
u=u.replace(
'''  irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
  mediaReady=!!(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present&&m.audio_sink_default);''',
'''  irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
  const s5Wifi=!!h.s5_host_reachable;
  mediaReady=!!(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present&&m.audio_sink_default);''',1)
u=u.replace(
'''  if(irReady)pill(e.irP,"IR",true);
  else{e.irP.textContent="IR Offline";e.irP.className="pill bad"}''',
'''  if(irReady)pill(e.irP,"IR",true);
  else if(s5Wifi){e.irP.textContent="S5 Wi-Fi · ADB/IR Off";e.irP.className="pill bad"}
  else{e.irP.textContent="S5 Offline";e.irP.className="pill bad"}''',1)
u=u.replace(
'''  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",irReady?"Samsung HT-E6500":"S5 Offline · Tap to Retry");''',
'''  const bridgeHint=irReady?"Samsung HT-E6500":(s5Wifi?"S5 on Wi-Fi · ADB/IR recovery needed":"S5 Offline · Tap to Retry");
  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",bridgeHint);''',1)
u=u.replace(
'''  if(!irReady){
    label(e.up,"Volume +","S5 Offline · Tap to Retry");
    label(e.down,"Volume −","S5 Offline · Tap to Retry");
  }''',
'''  if(!irReady){
    const volumeHint=s5Wifi?"S5 on Wi-Fi · ADB/IR recovery needed":"S5 Offline · Tap to Retry";
    label(e.up,"Volume +",volumeHint);
    label(e.down,"Volume −",volumeHint);
  }''',1)
u=u.replace(
'''  }else if(!irReady){
    label(e.macro,"Connect Surround","TV → HDMI 3 → Bluetooth · S5 IR auto-retry");
    status("TV Ready · S5 IR Offline · HTS Controls Will Retry IR");
  }else{''',
'''  }else if(!irReady){
    label(e.macro,"Connect Surround","TV → HDMI 3 → Bluetooth · S5 IR auto-retry");
    status(s5Wifi?"TV Ready · S5 on Wi-Fi · ADB/IR recovery needed":"TV Ready · S5 unreachable · HTS controls will retry");
  }else{''',1)
u=u.replace(
'''      const h=await req(8789,"/health","GET",10000);
      irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
      if(irReady){''',
'''      const h=await req(8789,"/health","GET",10000);
      irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
      if(irReady){''',1)
u=u.replace(
'''  e.irP.textContent="IR Offline";
  e.irP.className="pill unknown";
  throw new Error("S5 IR bridge unavailable"+(lastError?": "+String(lastError?.message||lastError):""));''',
'''  let h={};try{h=await req(8789,"/health","GET",5000)}catch(_){}
  if(h.s5_host_reachable){
    e.irP.textContent="S5 Wi-Fi · ADB/IR Off";
    e.irP.className="pill bad";
    throw new Error("S5 is on Wi-Fi but ADB/IR control is off · USB recovery needed");
  }
  e.irP.textContent="S5 Offline";
  e.irP.className="pill bad";
  throw new Error("S5 control unavailable"+(lastError?": "+String(lastError?.message||lastError):""));''',1)
UI.write_text(u,encoding="utf-8")

r=ROW.read_text(encoding="utf-8")
r,n=re.subn(r'c720p-tv-surround-v21\.html(?:\?v=[^"\']*)?',
            'c720p-tv-surround-v21.html?v=TV_S5_STATUS_V116_20261007',r)
if n<1: raise SystemExit("TV iframe cache anchor missing")
ROW.write_text(r,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(SERVER)],check=True)
subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service"],check=True)
time.sleep(1.5)

def get(url,timeout=10):
    try:
        with urllib.request.urlopen(url,timeout=timeout) as z:return z.status,json.loads(z.read().decode())
    except Exception as e:return 0,{"ok":False,"error":repr(e)}
code,h=get("http://127.0.0.1:8789/health",12)
assert code==200 and h.get("ok") is True
assert "s5_host_reachable" in h and "s5_recovery_state" in h
assert "C720P_TV_SURROUND_ACTIONS_V17_S5_WIFI_ADB_STATUS" in UI.read_text()

w=subprocess.run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],text=True,capture_output=True).stdout.strip()
if w: subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("BACKUP="+str(BACK))
print("HEALTH_HTTP="+str(code))
print("S5_HOST_REACHABLE="+str(h.get("s5_host_reachable")))
print("S5_RECOVERY_STATE="+str(h.get("s5_recovery_state")))
print("S5_CONNECTED="+str(h.get("s5_connected")))
print("S5_HTTP_OK="+str(bool((h.get("s5_http") or {}).get("ok"))))
print("UI_MARKER="+str("C720P_TV_SURROUND_ACTIONS_V17_S5_WIFI_ADB_STATUS" in UI.read_text()))
print("RESULT=TV_S5_ACCURATE_STATUS_V116_APPLIED")
