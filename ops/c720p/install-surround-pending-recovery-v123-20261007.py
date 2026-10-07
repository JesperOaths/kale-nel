#!/usr/bin/env python3
from pathlib import Path
import datetime, json, shutil, subprocess, time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNITS=HOME/".config/systemd/user"
STATE=BASE/"state"
SCRIPT=BIN/"c720p-surround-pending-recovery.py"
SERVICE=UNITS/"c720p-surround-pending-recovery.service"
TIMER=UNITS/"c720p-surround-pending-recovery.timer"
PENDING=STATE/"surround-pending-recovery.json"
RESULT=STATE/"surround-pending-recovery-state.json"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"surround-pending-recovery-v123-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (SCRIPT,SERVICE,TIMER,PENDING,RESULT):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

SCRIPT.write_text(r'''#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path

BASE=Path("/home/jespern/c720p-home-hub")
STATE=BASE/"state"
PENDING=STATE/"surround-pending-recovery.json"
RESULT=STATE/"surround-pending-recovery-state.json"

def write(obj):
    STATE.mkdir(parents=True,exist_ok=True)
    tmp=RESULT.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj,indent=2,sort_keys=True)+"\n")
    tmp.replace(RESULT)

def req(port,path,method="GET",timeout=20):
    u=f"http://127.0.0.1:{port}{path}"
    r=urllib.request.Request(u,method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:return json.loads(raw)
            except Exception:return {"ok":200<=x.status<300,"status":x.status,"raw":raw[-2000:]}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","replace")
        try:d=json.loads(raw)
        except Exception:d={"raw":raw[-2000:]}
        d.setdefault("ok",False);d["http_status"]=e.code;return d
    except Exception as e:
        return {"ok":False,"error":repr(e)}

def load_pending():
    try:return json.loads(PENDING.read_text())
    except Exception:return None

p=load_pending()
if not p:
    raise SystemExit(0)

now=time.time()
if now>=float(p.get("expires_at",0)):
    write({"ok":False,"state":"expired","at":now,"requested_at":p.get("requested_at")})
    PENDING.unlink(missing_ok=True)
    raise SystemExit(0)

health=req(8789,"/health",timeout=12)
s5_ready=bool(health.get("s5_connected") or (health.get("s5_http") or {}).get("ok"))
if not s5_ready:
    write({"ok":False,"state":"waiting_for_s5_control","at":now,
           "s5_lan":health.get("s5_lan"),"s5_transport":health.get("s5_transport"),
           "usb_auto_recovery":health.get("usb_auto_recovery")})
    raise SystemExit(0)

# Keep the TV half correct independently.
tv=req(8789,"/grundig-tv/on","POST",40)
hdmi=req(8789,"/grundig-tv/hdmi3-fast","POST",25)

stage=str(p.get("stage") or "start")
attempts=int(p.get("attempts") or 0)

if stage=="start":
    start=req(8790,"/pipeline/bluetooth-fast","POST",15)
    attempts+=1
    p.update(stage="waiting_audio",attempts=attempts,pipeline_started_at=now)
    PENDING.write_text(json.dumps(p,indent=2,sort_keys=True)+"\n")
    write({"ok":False,"state":"pipeline_started","at":now,"attempts":attempts,
           "tv":tv,"hdmi3":hdmi,"pipeline":start,"s5_transport":health.get("s5_transport")})
    raise SystemExit(0)

media=req(8790,"/state",timeout=12)
if media.get("live_ready") and media.get("bluetooth_connected") and media.get("audio_sink_present"):
    up=req(8789,"/ht-e6500/volume/up","POST",22)
    time.sleep(.8)
    down=req(8789,"/ht-e6500/volume/down","POST",22)
    final_media=req(8790,"/state",timeout=12)
    ok=bool(up.get("ok") and down.get("ok") and final_media.get("live_ready"))
    write({"ok":ok,"state":"complete" if ok else "volume_verification_failed",
           "at":time.time(),"attempts":attempts,"tv":tv,"hdmi3":hdmi,
           "volume_up":up,"volume_down":down,"media":final_media,
           "s5_transport":health.get("s5_transport")})
    if ok:PENDING.unlink(missing_ok=True)
    raise SystemExit(0 if ok else 1)

pipeline_state=str(media.get("pipeline_state") or "")
started=float(p.get("pipeline_started_at") or now)
if pipeline_state=="failed" or now-started>110:
    if attempts<3:
        start=req(8790,"/pipeline/bluetooth-fast","POST",15)
        attempts+=1
        p.update(stage="waiting_audio",attempts=attempts,pipeline_started_at=now)
        PENDING.write_text(json.dumps(p,indent=2,sort_keys=True)+"\n")
        write({"ok":False,"state":"pipeline_retried","at":now,"attempts":attempts,
               "pipeline":start,"last_media":media})
        raise SystemExit(0)
    write({"ok":False,"state":"pipeline_failed_after_retries","at":now,
           "attempts":attempts,"media":media})
    PENDING.unlink(missing_ok=True)
    raise SystemExit(1)

write({"ok":False,"state":"waiting_for_audio","at":now,"attempts":attempts,
       "pipeline_state":pipeline_state,"media":media})
''',encoding="utf-8")
SCRIPT.chmod(0o755)

SERVICE.write_text(f'''[Unit]
Description=Finish requested TV + surround recovery when S5 control returns
After=network-online.target

[Service]
Type=oneshot
ExecStart={SCRIPT}
''',encoding="utf-8")

TIMER.write_text('''[Unit]
Description=Pending TV + surround recovery watcher

[Timer]
OnBootSec=15s
OnUnitActiveSec=20s
AccuracySec=3s
Persistent=true
Unit=c720p-surround-pending-recovery.service

[Install]
WantedBy=timers.target
''',encoding="utf-8")

STATE.mkdir(parents=True,exist_ok=True)
now=time.time()
PENDING.write_text(json.dumps({
    "version":"v123",
    "requested_at":now,
    "expires_at":now+7200,
    "stage":"start",
    "attempts":0,
    "goal":"TV on + HDMI3 + HT-E6500 Bluetooth audio + volume up/down verification"
},indent=2,sort_keys=True)+"\n",encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(SCRIPT)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now",TIMER.name],check=True)
subprocess.run(["systemctl","--user","start",SERVICE.name],check=False)
time.sleep(1)

print("BACKUP="+str(BACK))
print("TIMER_ACTIVE="+subprocess.run(["systemctl","--user","is-active",TIMER.name],capture_output=True,text=True).stdout.strip())
print("PENDING="+PENDING.read_text().replace("\n"," | ")[:3000])
print("STATE="+(RESULT.read_text().replace("\n"," | ")[:5000] if RESULT.exists() else "missing"))
print("RESULT=SURROUND_PENDING_RECOVERY_V123_APPLIED")
