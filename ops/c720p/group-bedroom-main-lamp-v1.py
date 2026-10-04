#!/usr/bin/env python3
import json
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

GROUP = "light.c720p_bedroom_main_lamp"
MEMBERS = [
    "light.lsc_smart_connect_gu10_rgb_cct",
    "light.lsc_smart_connect_gu10_rgb_cct_2",
    "light.lsc_smart_connect_gu10_rgb_cct_3",
]
PACKAGE_HOST = Path("/opt/homeassistant/config/packages/c720p_bedroom_main_lamp_v1.yaml")
DASH_HOST = Path("/opt/homeassistant/config/.storage/lovelace.c720p_hub")
IMAGE = "ghcr.io/home-assistant/home-assistant:stable"

package = """# C720P_BEDROOM_MAIN_LAMP_V1
# Three GU10 bulbs in one physical bedroom lamp, exposed as one UI light.
template:
  - light:
      - name: C720P Bedroom Main Lamp
        unique_id: c720p_bedroom_main_lamp
        icon: mdi:ceiling-light-multiple
        state: >-
          {{ is_state('light.lsc_smart_connect_gu10_rgb_cct','on')
             or is_state('light.lsc_smart_connect_gu10_rgb_cct_2','on')
             or is_state('light.lsc_smart_connect_gu10_rgb_cct_3','on') }}
        level: >-
          {% set members = [
            'light.lsc_smart_connect_gu10_rgb_cct',
            'light.lsc_smart_connect_gu10_rgb_cct_2',
            'light.lsc_smart_connect_gu10_rgb_cct_3'
          ] %}
          {% set ns = namespace(total=0) %}
          {% for e in members %}
            {% if is_state(e,'on') %}
              {% set ns.total = ns.total + (state_attr(e,'brightness') | int(0)) %}
            {% endif %}
          {% endfor %}
          {{ (ns.total / 3) | round(0) | int }}
        turn_on:
          - action: light.turn_on
            target:
              entity_id:
                - light.lsc_smart_connect_gu10_rgb_cct
                - light.lsc_smart_connect_gu10_rgb_cct_2
                - light.lsc_smart_connect_gu10_rgb_cct_3
        turn_off:
          - action: light.turn_off
            target:
              entity_id:
                - light.lsc_smart_connect_gu10_rgb_cct
                - light.lsc_smart_connect_gu10_rgb_cct_2
                - light.lsc_smart_connect_gu10_rgb_cct_3
        set_level:
          - action: light.turn_on
            target:
              entity_id:
                - light.lsc_smart_connect_gu10_rgb_cct
                - light.lsc_smart_connect_gu10_rgb_cct_2
                - light.lsc_smart_connect_gu10_rgb_cct_3
            data:
              brightness: "{{ brightness }}"
"""

def run(cmd, check=True, capture=True):
    return subprocess.run(cmd, check=check, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.STDOUT if capture else None)

# Write package through the HA container so ownership is correct.
payload = package.encode()
p = subprocess.run(
    ["docker", "exec", "-i", "homeassistant", "python", "-c",
     "from pathlib import Path; import sys; Path('/config/packages/c720p_bedroom_main_lamp_v1.yaml').write_bytes(sys.stdin.buffer.read())"],
    input=payload, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
)
if p.returncode != 0:
    raise SystemExit(p.stdout.decode(errors="replace"))

check = run(["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"])
print(check.stdout, end="")
print("CONFIG_CHECK=OK")

# Stop HA before .storage edit.
run(["docker","stop","--time","25","homeassistant"], capture=True)

patch_code = r'''
from pathlib import Path
import json, shutil
from datetime import datetime

p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-bedroom-main-lamp-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
members={
 "light.lsc_smart_connect_gu10_rgb_cct",
 "light.lsc_smart_connect_gu10_rgb_cct_2",
 "light.lsc_smart_connect_gu10_rgb_cct_3",
}
group="light.c720p_bedroom_main_lamp"
cards_changed=0
rows_removed=0
rows_added=0

def eid(row):
    if isinstance(row,str):
        return row
    if isinstance(row,dict):
        return row.get("entity")
    return None

def walk(x):
    global cards_changed, rows_removed, rows_added
    if isinstance(x,dict):
        if x.get("type")=="entities" and isinstance(x.get("entities"),list):
            rows=x["entities"]
            idx=[i for i,r in enumerate(rows) if eid(r) in members]
            if len(idx)>=2:
                first=min(idx)
                new=[]
                inserted=False
                for i,r in enumerate(rows):
                    e=eid(r)
                    if e in members:
                        rows_removed += 1
                        if not inserted and i==first:
                            new.append({
                                "entity": group,
                                "name": "Bedroom Lamp",
                                "icon": "mdi:ceiling-light-multiple"
                            })
                            inserted=True
                            rows_added += 1
                        continue
                    if e==group:
                        if inserted:
                            continue
                        inserted=True
                    new.append(r)
                rows[:] = new
                cards_changed += 1
        for v in x.values():
            walk(v)
    elif isinstance(x,list):
        for v in x:
            walk(v)

walk(d)
if cards_changed < 1:
    raise SystemExit("No entities card containing >=2 bedroom GU10 rows was found")
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("DASH_BACKUP="+str(b))
print(f"DASH_PATCH=OK cards={cards_changed} removed={rows_removed} added={rows_added}")
'''
patch = run([
    "docker","run","--rm","-i",
    "-v","/opt/homeassistant/config:/config",
    IMAGE,"python","-c",patch_code
])
print(patch.stdout, end="")

run(["docker","start","homeassistant"], capture=True)
ok=False
for _ in range(50):
    try:
        r=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"])
        if r.stdout.strip()=="200":
            ok=True
            break
    except Exception:
        pass
    time.sleep(2)
print("HA_HTTP=200" if ok else "HA_HTTP=NOT_READY")
if not ok:
    raise SystemExit(5)

# Let template entities initialize, then verify registration and dashboard refs.
time.sleep(5)
reg = run(["docker","exec","homeassistant","sh","-lc","grep -c 'c720p_bedroom_main_lamp' /config/.storage/core.entity_registry || true"])
dash = run(["docker","exec","homeassistant","sh","-lc","grep -c 'light.c720p_bedroom_main_lamp' /config/.storage/lovelace.c720p_hub || true"])
raw = run(["docker","exec","homeassistant","sh","-lc","grep -Ec 'light.lsc_smart_connect_gu10_rgb_cct(_2|_3)?' /config/.storage/lovelace.c720p_hub || true"])
print("GROUP_REGISTRY_REFS="+reg.stdout.strip())
print("GROUP_DASH_REFS="+dash.stdout.strip())
print("RAW_GU10_DASH_REFS="+raw.stdout.strip())

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"], check=False)
time.sleep(10)
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).stdout.strip())

# Bring HA to foreground and capture proof image.
win = run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"]).stdout.strip()
if win:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
    time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-bedroom-grouped.png"],check=False)
print("SCREENSHOT=/tmp/c720p-bedroom-grouped.png")
