#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, pathlib, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
PKG=pathlib.Path("/opt/homeassistant/config/packages/c720p_presence_eco_v1.yaml")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"presence-ble-away-v4-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
if PKG.exists(): shutil.copy2(PKG,BACKUP/(PKG.name+".before"))

content=r'''# C720P_PRESENCE_ECO_V4_LOCAL_BLE
# Wallet + keys local BLE presence. Fail-safe by design:
# - both trackers must have been observed at least once;
# - the BLE scanner must be healthy and fresh;
# - both trackers must then be absent for >=15 minutes;
# - unknown/stale scanner state can never become Away.
input_number:
  c720p_away_auto_off_minutes:
    name: Away light shutoff delay
    icon: mdi:timer-off-outline
    min: 15
    max: 15
    step: 1
    unit_of_measurement: min
    mode: box
    initial: 15

command_line:
  - sensor:
      name: C720P Tag Presence Raw
      unique_id: c720p_tag_presence_raw
      command: "cat /config/www/c720p-tag-presence.json"
      scan_interval: 10
      value_template: "{{ 'ok' if value_json.scanner_ok else 'scanner_error' }}"
      json_attributes:
        - updated_at
        - scanner_ok
        - scanner_reason
        - monitor_uptime_seconds
        - last_any_ble_event
        - tag_a_name
        - tag_a_mac
        - tag_a_age_seconds
        - tag_a_last_seen
        - tag_a_best_rssi
        - tag_a_observed_once
        - tag_b_name
        - tag_b_mac
        - tag_b_age_seconds
        - tag_b_last_seen
        - tag_b_best_rssi
        - tag_b_observed_once
        - tags

template:
  - binary_sensor:
      - name: C720P Tracker A Present
        unique_id: c720p_tracker_a_present
        icon: mdi:wallet-outline
        availability: >-
          {{ states('sensor.c720p_tag_presence_raw') not in ['unknown','unavailable'] }}
        state: >-
          {% set seen = state_attr('sensor.c720p_tag_presence_raw','tag_a_observed_once') %}
          {% set age = state_attr('sensor.c720p_tag_presence_raw','tag_a_age_seconds') %}
          {{ seen == true and age is number and age <= 180 }}
        attributes:
          advertised_name: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_name') }}"
          mac: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_mac') }}"
          rssi: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_best_rssi') }}"
          age_seconds: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_age_seconds') }}"

      - name: C720P Tracker B Present
        unique_id: c720p_tracker_b_present
        icon: mdi:key-chain
        availability: >-
          {{ states('sensor.c720p_tag_presence_raw') not in ['unknown','unavailable'] }}
        state: >-
          {% set seen = state_attr('sensor.c720p_tag_presence_raw','tag_b_observed_once') %}
          {% set age = state_attr('sensor.c720p_tag_presence_raw','tag_b_age_seconds') %}
          {{ seen == true and age is number and age <= 180 }}
        attributes:
          advertised_name: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_name') }}"
          mac: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_mac') }}"
          rssi: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_best_rssi') }}"
          age_seconds: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_age_seconds') }}"

      - name: C720P Away Confident
        unique_id: c720p_away_confident
        icon: mdi:home-export-outline
        availability: >-
          {% set upd = state_attr('sensor.c720p_tag_presence_raw','updated_at') | int(0) %}
          {% set a_seen = state_attr('sensor.c720p_tag_presence_raw','tag_a_observed_once') %}
          {% set b_seen = state_attr('sensor.c720p_tag_presence_raw','tag_b_observed_once') %}
          {{ is_state('sensor.c720p_tag_presence_raw','ok')
             and upd > 0
             and (as_timestamp(now()) - upd) < 45
             and a_seen == true and b_seen == true }}
        state: >-
          {% set a = state_attr('sensor.c720p_tag_presence_raw','tag_a_age_seconds') %}
          {% set b = state_attr('sensor.c720p_tag_presence_raw','tag_b_age_seconds') %}
          {{ a is number and b is number and a >= 900 and b >= 900 }}
        attributes:
          rule: "Both wallet and keys absent for at least 15 minutes"
          fail_safe: "Never Away if scanner is stale/unhealthy or either tracker has never been seen"

  - sensor:
      - name: C720P Home Presence
        unique_id: c720p_home_presence
        icon: >-
          {% if is_state('binary_sensor.c720p_away_confident','on') %}mdi:home-export-outline
          {% elif is_state('binary_sensor.c720p_tracker_a_present','on') or is_state('binary_sensor.c720p_tracker_b_present','on') %}mdi:home-account
          {% else %}mdi:home-question{% endif %}
        state: >-
          {% set upd = state_attr('sensor.c720p_tag_presence_raw','updated_at') | int(0) %}
          {% set fresh = is_state('sensor.c720p_tag_presence_raw','ok')
                         and upd > 0 and (as_timestamp(now()) - upd) < 45 %}
          {% if not fresh %}Unknown
          {% elif is_state('binary_sensor.c720p_away_confident','on') %}Away
          {% elif is_state('binary_sensor.c720p_tracker_a_present','on')
                  or is_state('binary_sensor.c720p_tracker_b_present','on') %}Home
          {% else %}Unknown{% endif %}
        attributes:
          wallet_tracker: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_name') }}"
          keys_tracker: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_name') }}"
          wallet_age_seconds: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_a_age_seconds') }}"
          keys_age_seconds: "{{ state_attr('sensor.c720p_tag_presence_raw','tag_b_age_seconds') }}"
          away_delay_minutes: 15
          fail_safe: "Both trackers must be learned first; scanner failure never means Away"

automation:
  - id: c720p_presence_away_eco_off_v5
    alias: C720P Away - 15 min wallet+keys all lights off
    description: >-
      After both learned BLE trackers have been absent for 15 minutes while the
      local BLE scanner remains healthy, turn off every C720P light and apply
      the existing safe Away energy actions. Unknown scanner state never fires.
    mode: single
    trigger:
      - platform: state
        entity_id: binary_sensor.c720p_away_confident
        to: "on"
    condition:
      - condition: template
        value_template: >-
          {{ is_state('binary_sensor.c720p_away_confident','on') }}
    action:
      - action: light.turn_off
        target:
          entity_id: light.c720p_ui_all_lights
      - action: switch.turn_off
        target:
          entity_id: switch.lamp_woonkamer_socket_1
      - action: script.turn_on
        target:
          entity_id: script.c720p_away_mode
      - action: input_boolean.turn_on
        target:
          entity_id: input_boolean.c720p_energy_saver
      - if:
          - condition: template
            value_template: >-
              {{ state_attr('climate.radiator','temperature') | float(0) > 17 }}
        then:
          - action: climate.set_temperature
            target:
              entity_id: climate.radiator
            data:
              temperature: 17
      - if:
          - condition: template
            value_template: >-
              {{ states('media_player.hub_noordbruis') in ['playing','paused','idle'] }}
        then:
          - action: media_player.media_stop
            target:
              entity_id: media_player.hub_noordbruis
'''
PKG.write_text(content)

check=subprocess.run(
    ["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"],
    text=True,capture_output=True,timeout=180)
if check.returncode:
    if (BACKUP/(PKG.name+".before")).exists():
        shutil.copy2(BACKUP/(PKG.name+".before"),PKG)
    raise SystemExit("HA config check failed: "+(check.stdout+check.stderr)[-5000:])

subprocess.run(["systemctl","--user","enable","--now","c720p-tag-presence.service"],
               check=True,timeout=30)
subprocess.run(["docker","restart","homeassistant"],check=True,stdout=subprocess.DEVNULL,timeout=45)
deadline=time.time()+120
while time.time()<deadline:
    r=subprocess.run(["curl","-fsS","--max-time","2","http://127.0.0.1:8123/"],
                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if r.returncode==0: break
    time.sleep(2)
time.sleep(8)

raw={}
try: raw=json.loads(pathlib.Path("/opt/homeassistant/config/www/c720p-tag-presence.json").read_text())
except Exception as e: raw={"error":str(e)}
svc=subprocess.run(["systemctl","--user","show","c720p-tag-presence.service",
                    "-p","ActiveState","-p","SubState","-p","MainPID","-p","NRestarts"],
                   text=True,capture_output=True,timeout=10).stdout.strip()
print(json.dumps({
    "ok":True,
    "version":"presence-ble-away-v4",
    "backup":str(BACKUP),
    "ha_config_check":"pass",
    "scanner_service":svc,
    "delay_minutes":15,
    "all_lights_off_direct":True,
    "fail_safe_requires_both_trackers_seen_once":True,
    "raw_tracker_state":raw,
},indent=2))
