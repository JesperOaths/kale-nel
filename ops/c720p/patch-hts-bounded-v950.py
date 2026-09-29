#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET=Path('/home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py')
BACK=Path('/home/jespern/c720p-backups')/f'v950-bounded-hts-{time.strftime("%Y%m%d_%H%M%S")}'
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(TARGET,BACK/'c720p-bluetooth-helper-server.py.before')

s=TARGET.read_text()
marker='V950_BOUNDED_AFTER_FULL_SWEEP'
if marker not in s:
    old="    hts=prepare_hts_bluetooth(steps)\n    if hts.get('hts_input')=='failed':\n"
    new="    hts=prepare_hts_bluetooth(steps)\n    # V950_BOUNDED_AFTER_FULL_SWEEP\n    if hts.get('hts_input')=='adaptive_source_search_required':\n        failure='SAMSUNG_DEVICE_NOT_VISIBLE_AFTER_BOUNDED_SOURCE_SWEEP'\n        return 500, {'ok':False,'state':failure,'failure':failure,'hts':hts,'single_power_toggle_limit':True,'steps':steps}\n    if hts.get('hts_input')=='failed':\n"
    if old not in s:
        raise SystemExit('wrapper anchor missing')
    s=s.replace(old,new,1)

    pos=s.find('def pipeline(')
    if pos < 0:
        raise SystemExit('pipeline missing')
    sub=s[pos:]
    old2="    audio=connect_audio(steps)\n    if not audio.get('ok'):\n"
    new2="    if hts.get('hts_input') == 'adaptive_source_search_required':\n        failure='SAMSUNG_DEVICE_NOT_VISIBLE_AFTER_BOUNDED_SOURCE_SWEEP'\n        payload={'ok':False,'state':failure,'failure':failure,'hts_power':hts.get('hts_power'),'hts_input':hts.get('hts_input'),'single_power_toggle_limit':True,'steps':steps,'log':str(log_path)}\n        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\\n',encoding='utf-8')\n        return 500, write_state(payload)\n\n    audio = connect_audio(steps)\n    if not audio.get('ok'):\n"
    if old2 not in sub:
        raise SystemExit('pipeline anchor missing')
    sub=sub.replace(old2,new2,1)
    s=s[:pos]+sub
    TARGET.write_text(s)

subprocess.run(['python3','-m','py_compile',str(TARGET)],check=True)
subprocess.run(['systemctl','--user','restart','c720p-bluetooth-helper.service'],check=True)
time.sleep(2)
state=subprocess.run(['systemctl','--user','is-active','c720p-bluetooth-helper.service'],text=True,capture_output=True,check=False).stdout.strip()
if state!='active':
    raise SystemExit('helper not active after patch: '+state)
print('BACKUP='+str(BACK))
print('RESULT=V950_BOUNDED_HTS_HELPER_PATCHED')
