#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, os, pathlib, py_compile, re, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
AUT=pathlib.Path("/opt/homeassistant/config/automations.yaml")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v6-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
for p in (SCRIPT,AUT):
    if p.exists(): shutil.copy2(p,BACKUP/(p.name+".before"))

s=SCRIPT.read_text()

repls = [
    ('TARGET_PERIOD=0.50','TARGET_PERIOD=0.25'),
    ('TRIGGER_COOLDOWN_SECONDS=12.0','TRIGGER_COOLDOWN_SECONDS=10.0'),
    ('return {"mode":"dark","delta":2,"changed":0.025,"contour":6.0,"confirm":2}',
     'return {"mode":"dark","delta":1,"changed":0.015,"contour":4.0,"confirm":3}'),
    ('return {"mode":"dim","delta":4,"changed":0.08,"contour":18.0,"confirm":2}',
     'return {"mode":"dim","delta":3,"changed":0.05,"contour":10.0,"confirm":2}'),
    ('"version":"frontcam-motion-v5"','"version":"frontcam-motion-v6"'),
    ('FRONTCAM_MOTION_V5 starting; stability-gated dark-room motion; no images stored',
     'FRONTCAM_MOTION_V6 starting; high-sensitivity dark-room motion; no images stored'),
    ('FRONTCAM_MOTION_V5 stopped','FRONTCAM_MOTION_V6 stopped'),
]
for old,new in repls:
    if old in s: s=s.replace(old,new)

old='''            temporal_candidate=bool(
                th["mode"] in ("dark","dim")
                and temporal_changed>=max(0.02,th["changed"]*0.65)
                and temporal_largest>=max(5.0,th["contour"]*0.65)
                and temporal_changed<45.0)
'''
new='''            changed_pixels=max(1.0,temporal_changed*WIDTH*HEIGHT/100.0)
            live_coherence=float(temporal_largest)/changed_pixels
            temporal_candidate=bool(
                th["mode"] in ("dark","dim")
                and temporal_changed>=max(0.01,th["changed"]*0.55)
                and temporal_largest>=max(3.0,th["contour"]*0.55)
                and live_coherence>=0.06
                and temporal_changed<35.0)
'''
if old in s:
    s=s.replace(old,new,1)

# Use a one-pixel temporal threshold in dark mode. At 160x120 this is still
# negligible CPU, but it matters when the unlit webcam image has luma only 6-10.
s=s.replace('temporal_delta=max(2,th["delta"]-1) if th["mode"]=="dark" else th["delta"]',
            'temporal_delta=1 if th["mode"]=="dark" else max(2,th["delta"]-1) if th["mode"]=="dim" else th["delta"]')

SCRIPT.write_text(s)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)

# The motion detector itself decides whether the scene is dark and moving.
# Do not suppress the service call merely because HA thinks the plug is already on;
# a stale relay state should not prevent an attempted turn-on.
a=AUT.read_text()
main_start="# BEGIN C720P_FRONTCAM_MOTION_LIVING_LAMP_V1"
main_end="# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1"
if main_start not in a or main_end not in a:
    raise SystemExit("main frontcam automation block missing")
i=a.index(main_start); j=a.index(main_end,i)+len(main_end)
block=a[i:j]
block=re.sub(
    r'''  conditions:\n(?:    - .*\n(?:      .*\n)*)?  actions:''',
    '  conditions: []\n  actions:',
    block,
    count=1
)
# Exact fallback for the current known state-condition block.
block=block.replace(
'''  conditions:
    - condition: state
      entity_id: switch.lamp_woonkamer_socket_1
      state: "off"
  actions:''',
'''  conditions: []
  actions:''')
a=a[:i]+block+a[j:]

# Remove one-off diagnostic automations from tuning.
for start,end in [
    ("# BEGIN C720P_LIVING_LAMP_DARKTEST_V3","# END C720P_LIVING_LAMP_DARKTEST_V3"),
    ("# BEGIN C720P_LIVING_LAMP_RELAY_DIAG_V1","# END C720P_LIVING_LAMP_RELAY_DIAG_V1"),
]:
    while start in a and end in a:
        x=a.index(start); y=a.index(end,x)+len(end)
        a=a[:x].rstrip()+"\n\n"+a[y:].lstrip("\n")
AUT.write_text(a.rstrip()+"\n")

check=subprocess.run(
    ["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"],
    text=True,capture_output=True,timeout=180)
if check.returncode:
    shutil.copy2(BACKUP/(AUT.name+".before"),AUT)
    shutil.copy2(BACKUP/(SCRIPT.name+".before"),SCRIPT)
    raise SystemExit("HA config check failed: "+(check.stdout+check.stderr)[-4000:])

subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
subprocess.run(["docker","restart","homeassistant"],check=True,stdout=subprocess.DEVNULL,timeout=45)
deadline=time.time()+120
while time.time()<deadline:
    r=subprocess.run(["curl","-fsS","--max-time","2","http://127.0.0.1:8123/"],
                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if r.returncode==0: break
    time.sleep(2)
time.sleep(4)

state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
service=subprocess.run(
    ["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service",
     "-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
    text=True,capture_output=True,timeout=10).stdout.strip()
print(json.dumps({
    "ok":True,
    "version":"frontcam-motion-v6",
    "backup":str(BACKUP),
    "ha_config_check":"pass",
    "service":service,
    "state":state,
    "automation_unconditional_turn_on":True,
    "temporary_diagnostics_removed":True,
    "stores_images":False,
},indent=2))
