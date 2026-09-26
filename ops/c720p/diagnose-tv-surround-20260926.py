#!/usr/bin/env python3
import json, pathlib, subprocess, time, urllib.request

OUT=[]
def run(cmd, timeout=12, limit=9000):
    try:
        p=subprocess.run(cmd, shell=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        s=(p.stdout or "").strip()
        return f"RC={p.returncode}\n"+s[-limit:]
    except Exception as e:
        return "ERR="+type(e).__name__+":"+str(e)[:300]

OUT.append("TIME="+time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
OUT.append("=== HA_CONTAINER ===\n"+run("sudo -n docker inspect homeassistant --format '{{.State.Status}} restart={{.RestartCount}} started={{.State.StartedAt}}' 2>&1",5,1200))
OUT.append("=== MEDIA_SERVICES ===\n"+run("systemctl --user --no-pager --full status ht-e6500-surround.service c720p-bluetooth-helper.service c720p-home-hub-kiosk.service 2>&1",8,7000))
for label,url in [
    ("HT_STATE","http://127.0.0.1:8789/state"),
    ("HT_HEALTH","http://127.0.0.1:8789/health"),
    ("TV_POWER_STATE","http://127.0.0.1:8789/grundig-tv/power-state"),
    ("TV_STATUS","http://127.0.0.1:8789/grundig-tv/status"),
    ("BT_STATE","http://127.0.0.1:8790/state"),
]:
    OUT.append(f"=== {label} ===\n"+run(f"curl -sS --max-time 4 {url} 2>&1",6,4000))

widget=pathlib.Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
try: OUT.append("=== TV_WIDGET ===\n"+widget.read_text(errors="ignore")[:14000])
except Exception as e: OUT.append("=== TV_WIDGET ===\nERR="+repr(e))

server="/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py"
OUT.append("=== SURROUND_ROUTES ===\n"+run(f"grep -nE 'grundig|power-state|ensure-on|ensure-off|media/bluetooth|surround-bluetooth|recover|restart|systemctl|sleep|8790|hdmi3|POST|GET' {server} 2>&1 | head -320",8,12000))
OUT.append("=== GRUNDIG_HELPER ===\n"+run("sed -n '1,360p' /home/jespern/c720p-home-hub/bin/c720p-grundig-wifi-control.sh 2>&1",8,12000))
OUT.append("=== BLUETOOTH_HELPER ===\n"+run("grep -nE 'def |connect|recover|restart|systemctl|bluetooth|spotify|sleep|POST|GET' /home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py 2>&1 | head -320",8,12000))
OUT.append("=== RECENT_MEDIA_LOGS ===\n"+run("journalctl --user -u ht-e6500-surround.service -u c720p-bluetooth-helper.service -u c720p-home-hub-kiosk.service --since '-35 min' --no-pager -n 320 2>&1",10,14000))
OUT.append("=== HA_RESTART_LOGS ===\n"+run("sudo -n docker logs --since 35m homeassistant 2>&1 | grep -Ei 'restart|stopp|shutdown|fatal|error|exception' | tail -180",12,9000))

diag="\n".join(OUT)[-47000:]
token=pathlib.Path("/home/jespern/.config/c720p-agent/security-token").read_text().strip()
payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"maintenance":{"tv_surround_diag_990023":{"ok":True,"output":diag}}}
req=urllib.request.Request(
    "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
    data=json.dumps(payload,separators=(",",":")).encode(),
    method="POST",
    headers={"content-type":"application/json","x-c720p-token":token},
)
try:
    with urllib.request.urlopen(req,timeout=15) as r: print("HEALTH_POST",r.status)
except Exception as e: print("HEALTH_POST_ERR",type(e).__name__,str(e)[:240])

try:
    req2=urllib.request.Request(
        "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/ops-c720p-diag-ingest-v1",
        data=diag.encode(),
        method="POST",
        headers={"content-type":"text/plain; charset=utf-8","x-c720p-token":token},
    )
    with urllib.request.urlopen(req2,timeout=15) as r: print("DIAG_INGEST",r.status)
except Exception as e: print("DIAG_INGEST_ERR",type(e).__name__,str(e)[:240])
print(diag)
