#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess, re

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v910-tv-hts-failfast-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,UI):
    shutil.copy2(p,BACK/(p.name+".before"))

s=HELPER.read_text()

safe_fn=r'''def hts_ensure_on_safe():
    """Fast, guarded HTS path: never spend a long time guessing from an unobservable cold state."""
    steps=[]
    ok,failure=preflight(steps)
    if not ok:
        return 503, {'ok':False,'state':failure,'failure':failure,'steps':steps}

    bt=bt_connected_info()
    steps.append({'stage':'hts_precheck','check':'bluetooth','result':bt})
    if bt.get('connected'):
        audio=connect_audio(steps)
        if audio.get('ok'):
            live=audio['result']
            return 200, {
                'ok':True,'state':'connected_verified',
                'hts_power':'confirmed_on_by_active_bluetooth',
                'hts_input':'confirmed_bluetooth_by_active_connection',
                'bluetooth_connected':True,
                'audio_sink_present':bool(live.get('audio_sink_present')),
                'audio_sink_default':bool(live.get('audio_sink_default')),
                'audio_sink':live.get('audio_sink'),'steps':steps,
            }

    power=get_json('/ht-e6500/power-state',timeout=5)
    steps.append({'stage':'hts_precheck','check':'power_state','result':power})
    state=str(power.get('state') or '').lower()

    if state == 'off':
        wake=post_json('/ht-e6500/ensure-on',timeout=12)
        steps.append({'stage':'hts_power','action':'single_confirmed_off_to_on_attempt','result':wake})
        if not (wake.get('ok') and (wake.get('confirmed') is True or str(wake.get('state') or '').lower()=='on')):
            failure='HTS_POWER_NOT_CONFIRMED'
            return 503, {'ok':False,'state':failure,'failure':failure,
                         'cold_wake_unavailable':True,'steps':steps}
    elif state != 'on':
        failure='HTS_COLD_WAKE_UNAVAILABLE'
        return 503, {'ok':False,'state':failure,'failure':failure,
                     'cold_wake_unavailable':True,
                     'detail':'Receiver is not observable; refusing long blind source/power cycling.',
                     'steps':steps}

    hts=prepare_hts_bluetooth(steps)
    if hts.get('hts_input')=='failed':
        failure=hts.get('failure') or 'HTS_POWER_NOT_CONFIRMED'
        return 500, {'ok':False,'state':failure,'failure':failure,'hts':hts,'steps':steps}
    audio=connect_audio(steps)
    if not audio.get('ok'):
        failure=audio.get('failure') or 'SAMSUNG_DEVICE_NOT_CONNECTED'
        return 500, {'ok':False,'state':failure,'failure':failure,
                     'hts_power':hts.get('hts_power'),'hts_input':hts.get('hts_input'),
                     'steps':steps}
    live=audio['result']
    return 200, {
        'ok':True,'state':'connected_verified',
        'hts_power':'confirmed_on_by_active_bluetooth',
        'hts_input':'confirmed_bluetooth_by_active_connection',
        'bluetooth_connected':True,
        'audio_sink_present':bool(live.get('audio_sink_present')),
        'audio_sink_default':bool(live.get('audio_sink_default')),
        'audio_sink':live.get('audio_sink'),'steps':steps,
    }


'''
a=s.index("def hts_ensure_on_safe():")
b=s.index("def pipeline(open_music=False):",a)
s=s[:a]+safe_fn+s[b:]

new_pipeline=r'''def pipeline(open_music=False):
    """Truthful fast path in the requested order: TV -> HDMI3 -> HTS BT -> C720P audio."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f'tv-hts-bluetooth-pipeline-{time.strftime("%Y%m%d-%H%M%S")}.json'
    steps=[]
    ok,failure=preflight(steps)
    if not ok:
        payload={'ok':False,'state':failure,'failure':failure,'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 503,write_state(payload)

    # Fast cold-TV interlock. All available wake transports have already been
    # tested; do not burn tens of seconds on HTS recovery when the TV is cold.
    tv_now=get_json('/grundig-tv/power-state',timeout=5)
    steps.append({'stage':'tv_power','check':'initial_power_state','result':tv_now})
    tv_state=str(tv_now.get('state') or '').lower()
    if tv_state == 'off':
        payload={'ok':False,'state':'TV_COLD_WAKE_UNAVAILABLE','failure':'TV_COLD_WAKE_UNAVAILABLE',
                 'tv_power':'off','cold_wake_unavailable':True,
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 503,write_state(payload)

    tv_power=ensure_tv_on(steps)
    if tv_power.get('state')!='confirmed_on':
        payload={'ok':False,'state':'TV_POWER_NOT_CONFIRMED','failure':'TV_POWER_NOT_CONFIRMED',
                 'tv_power':'failed','steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 504,write_state(payload)

    tv_input=set_hdmi3(steps)
    if tv_input.get('state')!='confirmed_hdmi3':
        payload={'ok':False,'state':'HDMI3_NAVIGATION_FAILED','failure':'HDMI3_NAVIGATION_FAILED',
                 'tv_power':'confirmed_on','tv_input':tv_input.get('state'),
                 'tv_input_verification':tv_input.get('verification'),
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500,write_state(payload)

    bt=bt_connected_info()
    steps.append({'stage':'hts_precheck','check':'bluetooth','result':bt})
    if not bt.get('connected'):
        hp=get_json('/ht-e6500/power-state',timeout=5)
        steps.append({'stage':'hts_precheck','check':'power_state','result':hp})
        hs=str(hp.get('state') or '').lower()
        if hs == 'off':
            wake=post_json('/ht-e6500/ensure-on',timeout=12)
            steps.append({'stage':'hts_power','action':'single_confirmed_off_to_on_attempt','result':wake})
            if not (wake.get('ok') and (wake.get('confirmed') is True or str(wake.get('state') or '').lower()=='on')):
                payload={'ok':False,'state':'HTS_POWER_NOT_CONFIRMED','failure':'HTS_POWER_NOT_CONFIRMED',
                         'tv_power':'confirmed_on','tv_input':'confirmed_hdmi3',
                         'cold_wake_unavailable':True,'steps':steps,'log':str(log_path)}
                log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
                return 503,write_state(payload)
        elif hs != 'on':
            payload={'ok':False,'state':'HTS_COLD_WAKE_UNAVAILABLE','failure':'HTS_COLD_WAKE_UNAVAILABLE',
                     'tv_power':'confirmed_on','tv_input':'confirmed_hdmi3',
                     'cold_wake_unavailable':True,'steps':steps,'log':str(log_path)}
            log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            return 503,write_state(payload)

    hts=prepare_hts_bluetooth(steps)
    if hts.get('hts_input')=='failed':
        payload={'ok':False,'state':hts.get('failure'),'failure':hts.get('failure'),
                 'tv_power':'confirmed_on','tv_input':'confirmed_hdmi3',
                 'hts_power':hts.get('hts_power'),'hts_input':'failed',
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500,write_state(payload)

    audio=connect_audio(steps)
    if not audio.get('ok'):
        payload={'ok':False,'state':audio.get('failure'),'failure':audio.get('failure'),
                 'tv_power':'confirmed_on','tv_input':'confirmed_hdmi3',
                 'hts_power':hts.get('hts_power'),'hts_input':hts.get('hts_input'),
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500,write_state(payload)

    display=arm_s5_display(steps)
    spotify=None
    if open_music:
        spotify=open_spotify(); steps.append({'stage':'optional','action':'open_spotify','result':spotify})
    aj=audio['result']
    payload={'ok':True,'state':'connected_verified','tv_power':'confirmed_on',
             'tv_input':tv_input.get('state'),'tv_input_verification':tv_input.get('verification'),
             'hts_power':'confirmed_on_by_active_bluetooth',
             'hts_input':'confirmed_bluetooth_by_active_connection',
             'bluetooth_device':aj.get('bluetooth_device','SamsungHTS-8B063B'),
             'bluetooth_mac':aj.get('bluetooth_mac'),'bluetooth_connected':True,
             'audio_sink_present':bool(aj.get('audio_sink_present',True)),
             'audio_sink':aj.get('audio_sink'),'audio_sink_default':bool(aj.get('audio_sink_default',True)),
             'streams_moved':aj.get('streams_moved',True),
             'moved_sink_inputs':aj.get('moved_sink_inputs'),
             's5_display_timer_reset':display.get('ok',False),
             'steps':steps,'optional_spotify':spotify,'log':str(log_path)}
    log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return 200,write_state(payload)


'''
a=s.index("def pipeline(open_music=False):")
b=s.index("# C720P_TV_SURROUND_ASYNC_PIPELINE_V1",a)
s=s[:a]+new_pipeline+s[b:]
HELPER.write_text(s)

u=UI.read_text()
u=u.replace('data-controls-version="C720P_TV_SURROUND_ACTIONS_V10_SAFE_HTS_COLDSTART"',
            'data-controls-version="C720P_TV_SURROUND_ACTIONS_V11_FAILFAST_TRUTHFUL"')

u=u.replace(
'''  h.innerHTML=(S.busyHts?"HTS changing…":S.hts==="on"?"Turn HTS off":S.hts==="off"?"Turn HTS on":"Toggle HTS power")+
    '<span class="sub">'+(S.busyHts?"verifying…":S.hts==="on"?"receiver detected live":S.hts==="off"?"receiver confirmed off":"state not observable · manual toggle")+"</span>";''',
'''  h.innerHTML=(S.busyHts?"HTS changing…":S.hts==="on"?"Turn HTS off":S.hts==="off"?"Turn HTS on":"Check / wake HTS")+
    '<span class="sub">'+(S.busyHts?"verifying…":S.hts==="on"?"receiver detected live":S.hts==="off"?"receiver confirmed off":"state not observable · guarded check")+"</span>";'''
)

u=u.replace('const r=await reqBluetooth("/hts/ensure-on-safe","POST",45000);',
            'const r=await reqBluetooth("/hts/ensure-on-safe","POST",15000);')

u=u.replace('const deadline=Date.now()+35000;','const deadline=Date.now()+18000;')
u=u.replace('status("Media switch is still finishing in the background");',
            'status("Media switch stopped · no verified connection within 18 seconds");')

old_macro='''$("macro").onclick=async e=>{
  flash(e.currentTarget);if(S.busyMacro)return;
  S.busyMacro=true;render();status("Starting TV → HDMI 3 → Bluetooth…");
  const r=await reqBluetooth("/pipeline/bluetooth-fast","POST",2500);
  if(!r.ok){S.busyMacro=false;render();status("Could not start media switch");return}
  await followFastPipeline();
  S.busyMacro=false;
  await refresh(true);render()
};'''
new_macro='''$("macro").onclick=async e=>{
  flash(e.currentTarget);if(S.busyMacro)return;
  S.busyMacro=true;render();status("Checking TV and HTS state…");
  try{await Promise.all([refreshTV(),refreshHTS()])}catch(_){}
  render();
  if(S.tv==="off"){
    S.busyMacro=false;render();
    status("TV is off · cold wake is currently unavailable; no background retry started");
    return
  }
  status("Starting TV → HDMI 3 → Bluetooth…");
  const r=await reqBluetooth("/pipeline/bluetooth-fast","POST",2500);
  if(!r.ok){S.busyMacro=false;render();status("Could not start media switch");return}
  await followFastPipeline();
  S.busyMacro=false;
  await refresh(true);render()
};'''
if old_macro not in u:
    raise SystemExit("macro UI block missing")
u=u.replace(old_macro,new_macro,1)

UI.write_text(u)
subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service","ht-e6500-surround.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("RESULT=V910_TV_HTS_FAILFAST_PATCHED")
