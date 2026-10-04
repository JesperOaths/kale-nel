#!/usr/bin/env python3
import json, shutil, subprocess, time
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
PKG=CFG/"packages/c720p_energy_saver_v1.yaml"
SRC=CFG/"www/c720p-eco-timer-dual-v4.html"
DST=CFG/"www/c720p-eco-timer-dual-v5.html"
DASH=CFG/".storage/lovelace.c720p_hub"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"

def run(cmd, check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise SystemExit(p.stdout)
    return p.stdout

stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
shutil.copy2(PKG, PKG.with_name(PKG.name+".before-living-room-eco-"+stamp))

s=PKG.read_text()

repls={
"name: Living lamp max time":"name: Living room max light time",
"name: Living lamp daylight max":"name: Living room daylight max",
"{% elif not is_state('switch.lamp_woonkamer_socket_1','on') %}":"{% elif not is_state('light.c720p_ui_living_room_lights','on') %}",
"{% set elapsed = as_timestamp(now()) - as_timestamp(states.switch.lamp_woonkamer_socket_1.last_changed) %}":"{% set elapsed = as_timestamp(now()) - as_timestamp(states.light.c720p_ui_living_room_lights.last_changed) %}",
"target: switch.lamp_woonkamer_socket_1":"target: light.c720p_ui_living_room_lights",
"alias: C720P Eco Guard - Living lamp auto off":"alias: C720P Eco Guard - Living room auto off",
"entity_id: switch.lamp_woonkamer_socket_1\n        state: \"on\"":"entity_id: light.c720p_ui_living_room_lights\n        state: \"on\"",
"- action: switch.turn_off\n        target:\n          entity_id: switch.lamp_woonkamer_socket_1":"- action: light.turn_off\n        target:\n          entity_id: light.c720p_ui_living_room_lights",
}
for a,b in repls.items():
    if a not in s:
        raise SystemExit("Expected package fragment missing: "+a)
    s=s.replace(a,b)

# Sanity: living automation/sensor must not directly use the socket anymore.
segment=s[s.index("- name: C720P Living Lamp Eco Guard"):]
if "states.switch.lamp_woonkamer_socket_1.last_changed" in segment:
    raise SystemExit("Old socket-only elapsed logic remains")
PKG.write_text(s)
print("PACKAGE_PATCH=OK")

# Build frontend V5 from V4; the Living Room half follows the same authoritative aggregate.
f=SRC.read_text()
old='living:{sensor:"sensor.c720p_living_lamp_eco_guard",target:"switch.lamp_woonkamer_socket_1",normal:"input_number.c720p_living_lamp_auto_off_hours",day:"input_number.c720p_living_lamp_daylight_auto_off_hours",fallback:4,dayFallback:1}'
new='living:{sensor:"sensor.c720p_living_lamp_eco_guard",target:"light.c720p_ui_living_room_lights",normal:"input_number.c720p_living_lamp_auto_off_hours",day:"input_number.c720p_living_lamp_daylight_auto_off_hours",fallback:4,dayFallback:1}'
if old not in f:
    raise SystemExit("Expected frontend living config missing")
f=f.replace(old,new)
f=f.replace("ECO V4","ECO V5")
DST.write_text(f)
print("FRONTEND_V5=OK")

# Validate HA config before restart.
out=run(["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"])
print(out,end="")
print("CONFIG_CHECK=OK")

# Edit Lovelace only while HA is stopped.
run(["docker","stop","--time","25","homeassistant"])
patch=r'''
from pathlib import Path
import json,shutil
from datetime import datetime
p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-eco-v5-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
n=0
def walk(x):
 global n
 if isinstance(x,dict):
  if x.get("type")=="iframe" and "c720p-eco-timer-dual-v4.html" in str(x.get("url","")):
   x["url"]="/local/c720p-eco-timer-dual-v5.html?v=LIVING_ROOM_COMBINED_V5_20261004"
   n+=1
  for v in x.values(): walk(v)
 elif isinstance(x,list):
  for v in x: walk(v)
walk(d)
if n!=1:
 raise SystemExit("Expected exactly one Eco V4 iframe, got "+str(n))
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("DASH_BACKUP="+str(b))
print("DASH_ECO_V5_REFS="+str(n))
'''
print(run(["docker","run","--rm","-i","-v","/opt/homeassistant/config:/config",IMAGE,"python","-c",patch]),end="")
run(["docker","start","homeassistant"])

for _ in range(50):
    code=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"],check=False).strip()
    if code=="200":
        print("HA_HTTP=200")
        break
    time.sleep(2)
else:
    raise SystemExit("HA did not return 200")

time.sleep(6)

# Runtime verification without changing any light state.
dbcheck = run(["docker","exec","homeassistant","python","-c",
"""import sqlite3
c=sqlite3.connect('/config/home-assistant_v2.db')
ids=['light.c720p_ui_living_room_lights','light.woonkamer_plafond','switch.lamp_woonkamer_socket_1','sensor.c720p_living_lamp_eco_guard','automation.c720p_eco_guard_living_room_auto_off']
q='select m.entity_id,s.state from states s join states_meta m on m.metadata_id=s.metadata_id join (select metadata_id,max(state_id) sid from states group by metadata_id) z on z.sid=s.state_id where m.entity_id in (%s) order by m.entity_id' % ','.join('?' for _ in ids)
print(c.execute(q,ids).fetchall())
"""])
print("RUNTIME="+dbcheck.strip())

# Verify files no longer contain socket-only living target in guard/frontend.
assert "states.switch.lamp_woonkamer_socket_1.last_changed" not in PKG.read_text()
assert 'target:"switch.lamp_woonkamer_socket_1"' not in DST.read_text()
assert 'target:"light.c720p_ui_living_room_lights"' in DST.read_text()
print("SOURCE_VERIFY=OK")

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(10)
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())

# Foreground and screenshot for proof.
win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
    time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-eco-v5.png"],check=False)
print("SCREENSHOT=/tmp/c720p-eco-v5.png")
