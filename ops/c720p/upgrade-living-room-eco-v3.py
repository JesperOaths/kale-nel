#!/usr/bin/env python3
import json, subprocess, time
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
PKG=CFG/"packages/c720p_energy_saver_v1.yaml"
SRC=CFG/"www/c720p-eco-timer-dual-v4.html"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"

def run(cmd, check=True, input_bytes=None):
    p=subprocess.run(cmd,input=input_bytes,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    out=p.stdout.decode(errors="replace")
    if check and p.returncode:
        raise SystemExit(out)
    return out

stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
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
if "states.switch.lamp_woonkamer_socket_1.last_changed" in s[s.index("- name: C720P Living Lamp Eco Guard"):]:
    raise SystemExit("Socket-only elapsed logic still present")

f=SRC.read_text()
old='living:{sensor:"sensor.c720p_living_lamp_eco_guard",target:"switch.lamp_woonkamer_socket_1",normal:"input_number.c720p_living_lamp_auto_off_hours",day:"input_number.c720p_living_lamp_daylight_auto_off_hours",fallback:4,dayFallback:1}'
new='living:{sensor:"sensor.c720p_living_lamp_eco_guard",target:"light.c720p_ui_living_room_lights",normal:"input_number.c720p_living_lamp_auto_off_hours",day:"input_number.c720p_living_lamp_daylight_auto_off_hours",fallback:4,dayFallback:1}'
if old not in f:
    raise SystemExit("Expected frontend living config missing")
f=f.replace(old,new).replace("ECO V4","ECO V5")

# Backup and write through the HA container so ownership stays correct.
backup_cmd=f"cp /config/packages/c720p_energy_saver_v1.yaml /config/packages/c720p_energy_saver_v1.yaml.before-living-room-eco-{stamp}"
print(run(["docker","exec","homeassistant","sh","-lc",backup_cmd]),end="")
write_py="from pathlib import Path; import sys; p=Path(sys.argv[1]); p.write_bytes(sys.stdin.buffer.read())"
print(run(["docker","exec","-i","homeassistant","python","-c",write_py,"/config/packages/c720p_energy_saver_v1.yaml"],input_bytes=s.encode()),end="")
print(run(["docker","exec","-i","homeassistant","python","-c",write_py,"/config/www/c720p-eco-timer-dual-v5.html"],input_bytes=f.encode()),end="")
print("FILES_WRITTEN=OK")

# Validate before any restart.
print(run(["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"]),end="")
print("CONFIG_CHECK=OK")

# Safe Lovelace edit while HA stopped.
print(run(["docker","stop","--time","25","homeassistant"]),end="")
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
if n!=1: raise SystemExit("Expected one Eco V4 iframe, got "+str(n))
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("DASH_BACKUP="+str(b))
print("DASH_ECO_V5_REFS="+str(n))
'''
print(run(["docker","run","--rm","-i","-v","/opt/homeassistant/config:/config",IMAGE,"python","-c",patch]),end="")
print(run(["docker","start","homeassistant"]),end="")

for _ in range(50):
    code=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"],check=False).strip()
    if code=="200":
        print("HA_HTTP=200")
        break
    time.sleep(2)
else:
    raise SystemExit("HA did not return HTTP 200")

time.sleep(6)

# Verify current runtime state of both physical lights + aggregate + sensor.
check_code=r'''import sqlite3
c=sqlite3.connect("/config/home-assistant_v2.db")
ids=["light.c720p_ui_living_room_lights","light.woonkamer_plafond","switch.lamp_woonkamer_socket_1","sensor.c720p_living_lamp_eco_guard"]
q="select m.entity_id,s.state from states s join states_meta m on m.metadata_id=s.metadata_id join (select metadata_id,max(state_id) sid from states group by metadata_id) z on z.sid=s.state_id where m.entity_id in (%s) order by m.entity_id" % ",".join("?" for _ in ids)
print(c.execute(q,ids).fetchall())
'''
print("RUNTIME="+run(["docker","exec","homeassistant","python","-c",check_code]).strip())

pkg_now=PKG.read_text()
v5=(CFG/"www/c720p-eco-timer-dual-v5.html").read_text()
checks={
 "package_aggregate_elapsed":"states.light.c720p_ui_living_room_lights.last_changed" in pkg_now,
 "package_aggregate_action":"entity_id: light.c720p_ui_living_room_lights" in pkg_now,
 "frontend_aggregate_target":'target:"light.c720p_ui_living_room_lights"' in v5,
 "socket_elapsed_removed":"states.switch.lamp_woonkamer_socket_1.last_changed" not in pkg_now,
}
print("SOURCE_CHECKS="+json.dumps(checks,sort_keys=True))
if not all(checks.values()): raise SystemExit("Source verification failed")

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(10)
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())

win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
    time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-eco-v5.png"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print("SCREENSHOT=/tmp/c720p-eco-v5.png")
