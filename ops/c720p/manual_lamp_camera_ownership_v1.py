#!/usr/bin/env python3
from pathlib import Path
import shutil,subprocess,json,datetime,time,sys
cfg=Path('/opt/homeassistant/config')
eco=cfg/'packages/c720p_energy_saver_v1.yaml'
aut=cfg/'automations.yaml'
s=eco.read_text();a=aut.read_text()
if 'c720p_living_camera_owned:' in s:
    print('already_applied');sys.exit(0)
assert s.count('input_boolean:\n')==1
s=s.replace('input_boolean:\n','input_boolean:\n  c720p_living_camera_owned:\n    name: Living lamp automatic on\n    initial: false\n',1)
start=s.index('  - id: c720p_energy_saver_living_lamp_v1')
t=s[start:]
old='''      - condition: state
        entity_id: light.c720p_ui_living_room_lights
        state: "on"
'''
new='''      - condition: state
        entity_id: input_boolean.c720p_living_camera_owned
        state: "on"
      - condition: state
        entity_id: switch.lamp_woonkamer_socket_1
        state: "on"
'''
assert t.count(old)==1
t=t.replace(old,new,1)
t=t.replace('states.light.c720p_ui_living_room_lights.last_changed','states.switch.lamp_woonkamer_socket_1.last_changed',1)
old='''    action:
      - action: light.turn_off
        target:
          entity_id: light.c720p_ui_living_room_lights
'''
new='''    action:
      - action: switch.turn_off
        target:
          entity_id: switch.lamp_woonkamer_socket_1
      - action: input_boolean.turn_off
        target:
          entity_id: input_boolean.c720p_living_camera_owned
'''
assert t.count(old)==1
s=s[:start]+t.replace(old,new,1)
s=s.rstrip()+'''
  - id: c720p_living_camera_ownership_reset
    alias: Living lamp camera ownership reset on off
    trigger:
      - platform: state
        entity_id: switch.lamp_woonkamer_socket_1
        to: "off"
    action:
      - action: input_boolean.turn_off
        target:
          entity_id: input_boolean.c720p_living_camera_owned
'''+'\n'
start=a.index('- id: c720p_frontcam_motion_living_lamp_v1')
end=a.index('# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1',start)
block=a[start:end]
old='''  conditions: []
  actions:
    - action: switch.turn_on
      target:
        entity_id: switch.lamp_woonkamer_socket_1
'''
new='''  conditions:
    - condition: state
      entity_id: switch.lamp_woonkamer_socket_1
      state: "off"
  actions:
    - action: input_boolean.turn_on
      target:
        entity_id: input_boolean.c720p_living_camera_owned
    - action: switch.turn_on
      target:
        entity_id: switch.lamp_woonkamer_socket_1
'''
assert block.count(old)==1
a=a[:start]+block.replace(old,new,1)+a[end:]
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'manual_lamp_auto_off_blocked':True}))
 sys.exit(0)
back=Path('/home/jespern/c720p-backups')/('living-manual-'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
back.mkdir(parents=True)
shutil.copy2(eco,back/'eco.before');shutil.copy2(aut,back/'automations.before')
def run(c,t=180):return subprocess.run(c,capture_output=True,text=True,timeout=t)
try:
 eco.write_text(s);aut.write_text(a)
 check=run(['docker','exec','homeassistant','python','-m','homeassistant','--script','check_config','-c','/config'])
 if check.returncode:raise RuntimeError('HA config check: '+(check.stdout+check.stderr)[-1000:])
 r=run(['docker','restart','homeassistant'],65)
 if r.returncode:raise RuntimeError(r.stderr[-1000:])
 for i in range(60):
  p=run(['curl','-s','-o','/dev/null','-w','%{http_code}','--max-time','2','http://127.0.0.1:8123/'],5)
  if p.stdout.strip()=='200':break
  time.sleep(2)
 else:raise RuntimeError('HA not online')
 print(json.dumps({'ok':True,'backup':str(back),'config':'pass','manual_priority':True,'auto_off_only_after_camera_on':True}))
except:
 shutil.copy2(back/'eco.before',eco);shutil.copy2(back/'automations.before',aut)
 run(['docker','restart','homeassistant'],65)
 raise
