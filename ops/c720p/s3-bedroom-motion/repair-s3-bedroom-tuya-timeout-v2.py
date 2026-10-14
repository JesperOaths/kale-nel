#!/usr/bin/env python3
"""Guarded S3 5-minute timeout failure recovery after Tuya sign invalid.

Keeps camera ownership until all three independently confirm OFF. Per-bulb
commands continue on failure and retry. A rate-limited Tuya config-entry
reload recovers expired cloud signatures. Camera-generated OFF state events
during the short shutdown cycle do not masquerade as manual intervention.
All genuine manual HA service calls and explicit external ON transitions still
cancel ownership. Safety cap: at most one Tuya reload per 10 minutes.
The script backs up the exact HA package and preserves all other automations.
"""
from __future__ import annotations
import datetime,os,pathlib,json,sys,subprocess
FILE=pathlib.Path("/opt/homeassistant/config/packages/c720p_s3_bedroom_occupancy_v1.yaml")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/s3-bedroom-tuya-timeout-v2")
START="  - id: c720p_s3_bedroom_motion_timeout_v1\n"
END="  - id: c720p_s3_bedroom_manual_ha_service_override_v1\n"
MANUAL_START="  - id: c720p_s3_bedroom_manual_external_state_override_v1\n"
MARK="C720P_S3_TUYA_TIMEOUT_GUARDED_V2"
TUYA_ENTRY="01KSBC5AW01RVHGSA0ESJR85ZX"
OWNED="input_boolean.c720p_s3_bedroom_camera_owned"
SHUT="input_boolean.c720p_s3_bedroom_shutdown_in_progress"
MOTION="input_datetime.c720p_s3_bedroom_last_motion"
RELOAD="input_datetime.c720p_s3_bedroom_tuya_reload"
LIGHTS=("light.lsc_smart_connect_gu10_rgb_cct","light.lsc_smart_connect_gu10_rgb_cct_2","light.lsc_smart_connect_gu10_rgb_cct_3")
def guard_same():
 return ("{{ is_state('"+OWNED+"','on') and "
         "states('"+MOTION+"') == motion_at_start and "
         "(as_timestamp(now()) - as_timestamp(states('"+MOTION+"'),0)) >= 300 }}")
def lights_off():
 return "{{ "+ " and ".join("is_state('"+x+"','off')" for x in LIGHTS)+" }}"
def commands(ind):
 s=""
 for n in LIGHTS:
  s+=f"{ind}- action: light.turn_off\n{ind}  continue_on_error: true\n{ind}  target:\n{ind}    entity_id: {n}\n"
 return s
def check_yaml(body):
 # HA container has PyYAML. Validate parse, relevant IDs and action contracts.
 p=subprocess.run(["docker","exec","-i","homeassistant","python3","-c",
  "import sys,yaml,json; d=yaml.safe_load(sys.stdin.read()); assert 'automation' in d; "
  "a={x['id']:x for x in d['automation']}; "
  "v=a['c720p_s3_bedroom_motion_timeout_v1']; "
  "assert v['triggers'][0]['event_type']=='timer.finished'; "
  "assert 'c720p_s3_bedroom_shutdown_in_progress' in d['input_boolean']; "
  "assert 'c720p_s3_bedroom_tuya_reload' in d['input_datetime']; "
  "print(json.dumps({'yaml_ok':True,'automations':list(a),'timeout_actions':len(v['actions'])}))"],
  input=body,text=True,capture_output=True,timeout=35)
 if p.returncode:raise RuntimeError("HA_yaml_validation_failed:"+p.stderr[-1000:]+p.stdout[-500:])
 return p.stdout.strip()
def main():
 if not FILE.is_file() or FILE.is_symlink():raise RuntimeError("missing_or_symlink_package")
 raw=FILE.read_bytes()
 newline="\r\n" if b"\r\n" in raw else "\n"
 s=raw.decode()
 if MARK in s:
  print(json.dumps({"already_installed":True,"marker":MARK}));return 0
 if s.count(START)!=1 or s.count(END)!=1 or s.count(MANUAL_START)!=1:
  raise RuntimeError("unexpected_current_automation_layout")
 if not (s.index(START)<s.index(END)<s.index(MANUAL_START)):
  raise RuntimeError("unexpected_automation_order")
 if s.count('  c720p_s3_bedroom_camera_owned:')!=1:
  raise RuntimeError("missing_ownership_helper")
 # Add short-lived suppression for the camera's own OFF responses.
 helper="  c720p_s3_bedroom_camera_owned:\n    name: S3 bedroom motion owns lights\n    icon: mdi:motion-sensor\n    initial: false\n"
 if s.count(helper)!=1:raise RuntimeError("ownership_helper_changed")
 s=s.replace(helper,helper+"  c720p_s3_bedroom_shutdown_in_progress:\n    name: S3 bedroom motion ending\n    initial: false\n",1)
 dt="  c720p_s3_bedroom_last_motion:\n    name: S3 bedroom last motion\n    has_date: true\n    has_time: true\n"
 if s.count(dt)!=1:raise RuntimeError("last_motion_helper_changed")
 s=s.replace(dt,dt+"  c720p_s3_bedroom_tuya_reload:\n    name: S3 bedroom Tuya recovery last attempted\n    has_date: true\n    has_time: true\n",1)
 # Keep manual change recognition while suppressing camera-origin OFF state
 # notifications during command retries. User-id and direct external ON
 # (genuine OFF->ON transition) still break camera ownership immediately.
 old="""          {{ s is not none and
             (s.state in ['off','unavailable']
              or s.context.user_id is not none
              or age >= 15) }}"""
 new="""          {{ s is not none and
             (s.context.user_id is not none
              or (s.state == 'on' and trigger.from_state is not none
                  and trigger.from_state.state == 'off' and age >= 15)
              or (not is_state('input_boolean.c720p_s3_bedroom_shutdown_in_progress','on')
                  and (s.state in ['off','unavailable'] or age >= 15))) }}"""
 if s.count(old)!=1:raise RuntimeError("external_override_condition_changed")
 s=s.replace(old,new,1)
 same=guard_same()
 off=lights_off()
 any_on="{{ not ("+off.removeprefix("{{ ").removesuffix(" }}")+") }}"
 # If sign-invalid leaves any bulbs on, refreshing cloud auth is done at
 # most once per ten minutes, followed by a fresh individually-targeted retry.
 timeout=f"""  - id: c720p_s3_bedroom_motion_timeout_v1
    alias: S3 bedroom - five-minute camera-only timeout
    description: {MARK}; keep ownership until all three lights acknowledge off
    triggers:
      - trigger: event
        event_type: timer.finished
        event_data:
          entity_id: timer.c720p_s3_bedroom_motion
      - trigger: time_pattern
        minutes: "/1"
    conditions:
      - condition: state
        entity_id: {OWNED}
        state: "on"
      - condition: template
        value_template: >-
          {{{{ as_timestamp(now())-as_timestamp(states('{MOTION}'),0) >= 300 }}}}
    actions:
      - variables:
          motion_at_start: "{{{{ states('{MOTION}') }}}}"
      - action: input_boolean.turn_on
        target:
          entity_id: {SHUT}
      - delay: "00:00:01"
      - choose:
          - conditions:
              - condition: template
                value_template: >-
                  {same}
            sequence:
{commands('              ')}              - delay: "00:00:03"
              - choose:
                  - conditions:
                      - condition: template
                        value_template: >-
                          {{{{ {any_on.removeprefix('{{ ').removesuffix(' }}')} and
                              is_state('{OWNED}','on') and
                              states('{MOTION}') == motion_at_start and
                              (as_timestamp(now())-as_timestamp(states('{RELOAD}'),0)) >= 600 }}}}
                    sequence:
                      - action: input_datetime.set_datetime
                        target:
                          entity_id: {RELOAD}
                        data:
                          timestamp: "{{{{ as_timestamp(now()) }}}}"
                      - action: homeassistant.reload_config_entry
                        continue_on_error: true
                        data:
                          entry_id: {TUYA_ENTRY}
                      - delay: "00:00:08"
              - choose:
                  - conditions:
                      - condition: template
                        value_template: >-
                          {{{{ {any_on.removeprefix('{{ ').removesuffix(' }}')} and
                              is_state('{OWNED}','on') and
                              states('{MOTION}') == motion_at_start and
                              (as_timestamp(now())-as_timestamp(states('{MOTION}'),0)) >= 300 }}}}
                    sequence:
{commands('                      ')}                      - delay: "00:00:03"
              - choose:
                  - conditions:
                      - condition: template
                        value_template: >-
                          {{{{ {off.removeprefix('{{ ').removesuffix(' }}')} and
                              is_state('{OWNED}','on') and
                              states('{MOTION}') == motion_at_start }}}}
                    sequence:
                      - action: input_boolean.turn_off
                        target:
                          entity_id: {OWNED}
                      - action: timer.cancel
                        target:
                          entity_id: timer.c720p_s3_bedroom_motion
      - action: input_boolean.turn_off
        target:
          entity_id: {SHUT}
    mode: single

"""
 start=s.index(START);end=s.index(END)
 s=s[:start]+timeout+s[end:]
 result=check_yaml(s)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/(stamp+".before.yaml")
 with backup.open("xb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
 backup.chmod(0o600)
 temp=FILE.with_name("."+FILE.name+".s3-timeout-v2.tmp")
 try:
  with temp.open("wb") as f:f.write(s.replace("\n",newline).encode());f.flush();os.fsync(f.fileno())
  temp.chmod(FILE.stat().st_mode&0o777)
  os.replace(temp,FILE)
  if MARK not in FILE.read_text():raise RuntimeError("readback_failed")
 finally:
  temp.unlink(missing_ok=True)
 print(json.dumps({"ok":True,"version":MARK,"backup":str(backup),
  "yaml_validation":result,"s3_timeout":"300 seconds since last motion",
  "per_bulb_retries":True,"camera_ownership_clears_only_all_off":True,
  "tuya_reload_cooldown_seconds":600,"manual_override_preserved":True},sort_keys=True))
 return 0
if __name__=="__main__":sys.exit(main())
