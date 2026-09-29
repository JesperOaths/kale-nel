#!/usr/bin/env python3
from pathlib import Path
import subprocess, textwrap, time, shutil, os

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
BIN=BASE/"bin"
UNIT=HOME/".config/systemd/user"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v919-controlplane-watchdog-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

watch=BIN/"c720p-controlplane-watchdog-v919.py"
svc=UNIT/"c720p-controlplane-watchdog.service"
timer=UNIT/"c720p-controlplane-watchdog.timer"
inhibit_svc=UNIT/"c720p-no-suspend.service"

for p in (watch,svc,timer,inhibit_svc):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

watch.write_text(textwrap.dedent(r'''
#!/usr/bin/env python3
import json, pathlib, subprocess, time, urllib.request

HOME=pathlib.Path("/home/jespern")
STATE=HOME/"c720p-home-hub/state/controlplane-watchdog.json"
STATE.parent.mkdir(parents=True,exist_ok=True)
AGENT="c720p-agent-runner.service"
TUNNEL="c720p-security-tunnel.service"
URL="https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/ops-c720p-run-ok"

def sh(args,timeout=8):
    try:
        p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return p.returncode,(p.stdout or "")[-4000:]
    except Exception as e:
        return 99,repr(e)

def read_state():
    try:return json.loads(STATE.read_text())
    except Exception:return {}

def write_state(s):
    tmp=STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s,indent=2,sort_keys=True)+"\n")
    tmp.replace(STATE)

now=time.time()
s=read_state()
ok=False
err=""
try:
    req=urllib.request.Request(URL,headers={"user-agent":"c720p-controlplane-watchdog-v919"})
    with urllib.request.urlopen(req,timeout=6) as r:
        ok=200 <= r.status < 500
except Exception as e:
    err=repr(e)

if ok:
    s.update(last_ok=now,fail_streak=0,last_error="",last_action="healthy")
    # The agent can be active-but-wedged. A cheap periodic refresh after a prolonged
    # outage is safer than rebooting the host.
    rc,out=sh(["systemctl","--user","is-active",AGENT],5)
    if rc!=0 or out.strip()!="active":
        sh(["systemctl","--user","restart",AGENT],10)
        s["last_action"]="agent_restart_not_active"
    rc2,out2=sh(["systemctl","--user","is-active",TUNNEL],5)
    if rc2!=0 or out2.strip()!="active":
        sh(["systemctl","--user","restart",TUNNEL],10)
        s["last_action"]=(s["last_action"]+"+tunnel_restart").strip("+")
    write_state(s)
    raise SystemExit(0)

fs=int(s.get("fail_streak",0))+1
s.update(fail_streak=fs,last_error=err,last_fail=now)
# First failures: only restart user-space control services.
if fs in (2,4):
    sh(["systemctl","--user","restart",AGENT],10)
    sh(["systemctl","--user","restart",TUNNEL],10)
    s["last_action"]="restart_agent_and_tunnel"
# Sustained failure: ask NetworkManager for a reconnect, but never reboot the hub.
elif fs==8:
    rc,out=sh(["nmcli","networking","connectivity","check"],10)
    s["nm_connectivity"]=out.strip()
    # Try non-destructive radio reconnect first.
    sh(["nmcli","radio","wifi","on"],6)
    sh(["nmcli","device","connect","wlan0"],15)
    s["last_action"]="wifi_reconnect_attempt"
elif fs>=20 and fs%10==0:
    # Keep services fresh while preserving HA and all local functions.
    sh(["systemctl","--user","restart",AGENT],10)
    sh(["systemctl","--user","restart",TUNNEL],10)
    s["last_action"]="periodic_controlplane_refresh"
write_state(s)
''').lstrip())
watch.chmod(0o755)

svc.write_text(textwrap.dedent(f'''[Unit]
Description=C720P outbound control-plane self-heal watchdog
After=network-online.target

[Service]
Type=oneshot
ExecStart={watch}
Nice=10
'''))

timer.write_text(textwrap.dedent('''[Unit]
Description=Run C720P control-plane self-heal watchdog

[Timer]
OnBootSec=45s
OnUnitActiveSec=60s
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
'''))

# User-space inhibitor: protects a dedicated always-on hub from suspend/lid sleep
# without requiring a full machine reboot or editing logind.conf.
inhibit_svc.write_text(textwrap.dedent('''[Unit]
Description=Keep dedicated C720P hub awake
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/systemd-inhibit --what=sleep:idle:handle-lid-switch --who=C720P-Hub --why=Dedicated Home Assistant hub must remain online --mode=block /usr/bin/sleep infinity
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
'''))

subprocess.run(["python3","-m","py_compile",str(watch)],check=True)
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","c720p-controlplane-watchdog.timer","c720p-no-suspend.service"],check=True)
# Refresh the control services once when installing.
subprocess.run(["systemctl","--user","restart","c720p-agent-runner.service"],check=False)
subprocess.run(["systemctl","--user","restart","c720p-security-tunnel.service"],check=False)
print("BACKUP="+str(BACK))
print("RESULT=V919_CONTROLPLANE_WATCHDOG_INSTALLED")
