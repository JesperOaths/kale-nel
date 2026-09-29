#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v874-tv-hts-repair-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,UI):
    shutil.copy2(p,BACK/(p.name+".before"))

s=HELPER.read_text()

new_prepare=r'''def prepare_hts_bluetooth(steps):
    """Safely get the HT-E6500 on and toward Bluetooth without blind double-toggles."""
    before = bt_connected_info()
    steps.append({'stage':'hts_bluetooth','check':'initial_bluetooth_connection','result':before})
    if before.get('connected'):
        return {
            'hts_power':'confirmed_on_by_active_bluetooth',
            'hts_input':'confirmed_bluetooth_by_active_connection',
            'skipped_ir':True,
            'evidence':before,
        }

    power = get_json('/ht-e6500/power-state', timeout=8)
    steps.append({'stage':'hts_power','check':'initial_power_state','result':power})

    # State can legitimately be unknown while the receiver is awake. Try source
    # navigation and a real BlueZ connection before touching power.
    if str(power.get('state') or '').lower() != 'on':
        anchor = post_json('/ht-e6500/dvd', timeout=5)
        steps.append({'stage':'hts_bluetooth','action':'probe_existing_power_anchor_dvd','result':anchor})
        for cycle in range(1,8):
            if _quick_bt_connect(steps,f'prepower_quick_connect_{cycle}',timeout=2):
                return {
                    'hts_power':'confirmed_on_by_active_bluetooth',
                    'hts_input':'confirmed_bluetooth_by_active_connection',
                    'power_toggle_sent':False,
                    'evidence':power,
                }
            fn=post_json('/ht-e6500/function-fast', timeout=5)
            steps.append({'stage':'hts_bluetooth','action':'prepower_function_cycle','cycle':cycle,'result':fn})
            if not fn.get('ok'):
                break
            time.sleep(0.28)

        # No live evidence after a complete source pass: issue exactly ONE power
        # toggle. No automatic retry is allowed during this run.
        toggle = post_json('/ht-e6500/power', timeout=10)
        steps.append({'stage':'hts_power','action':'single_guarded_power_toggle_from_unknown','result':toggle})
        if not toggle.get('ok'):
            return {
                'hts_power':'failed',
                'hts_input':'failed',
                'failure':'HTS_POWER_COMMAND_FAILED',
                'evidence':toggle,
            }
        time.sleep(1.4)

    # Walk the known BD/DVD -> ... -> BT sequence and stop immediately when
    # BlueZ proves the receiver is available.
    anchor = post_json('/ht-e6500/dvd', timeout=5)
    steps.append({'stage':'hts_bluetooth','action':'deterministic_bt_anchor_dvd','result':anchor})
    if _quick_bt_connect(steps,'connect_after_dvd_anchor',timeout=2.5):
        return {
            'hts_power':'confirmed_on_by_active_bluetooth',
            'hts_input':'confirmed_bluetooth_by_active_connection',
            'evidence':power,
        }
    for cycle in range(1,8):
        fn=post_json('/ht-e6500/function-fast', timeout=5)
        steps.append({'stage':'hts_bluetooth','action':'deterministic_function_to_bt','cycle':cycle,'result':fn})
        if not fn.get('ok'):
            break
        time.sleep(0.35)
        if _quick_bt_connect(steps,f'connect_after_function_{cycle}',timeout=2.5):
            return {
                'hts_power':'confirmed_on_by_active_bluetooth',
                'hts_input':'confirmed_bluetooth_by_active_connection',
                'evidence':power,
            }

    # Power was commanded at most once. Leave it alone and let connect_audio()
    # perform the longer discovery pass; never toggle power again automatically.
    return {
        'hts_power':'commanded_or_existing_on_unverified',
        'hts_input':'adaptive_source_search_required',
        'single_power_toggle_limit':True,
        'evidence':power,
    }


'''
a=s.index("def prepare_hts_bluetooth(steps):")
b=s.index("def _quick_bt_connect",a)
s=s[:a]+new_prepare+s[b:]

safe_fn=r'''def hts_ensure_on_safe():
    """HTS-only cold-start path used by the dashboard power control."""
    steps=[]
    ok,failure=preflight(steps)
    if not ok:
        return 503, {'ok':False,'state':failure,'failure':failure,'steps':steps}
    hts=prepare_hts_bluetooth(steps)
    if hts.get('hts_input')=='failed':
        failure=hts.get('failure') or 'HTS_POWER_NOT_CONFIRMED'
        return 500, {'ok':False,'state':failure,'failure':failure,'hts':hts,'steps':steps}
    audio=connect_audio(steps)
    if not audio.get('ok'):
        failure=audio.get('failure') or 'SAMSUNG_DEVICE_NOT_CONNECTED'
        return 500, {
            'ok':False,'state':failure,'failure':failure,
            'hts_power':hts.get('hts_power'),'hts_input':hts.get('hts_input'),
            'single_power_toggle_limit':True,'steps':steps,
        }
    live=audio['result']
    return 200, {
        'ok':True,'state':'connected_verified',
        'hts_power':'confirmed_on_by_active_bluetooth',
        'hts_input':'confirmed_bluetooth_by_active_connection',
        'bluetooth_connected':True,
        'audio_sink_present':bool(live.get('audio_sink_present')),
        'audio_sink_default':bool(live.get('audio_sink_default')),
        'audio_sink':live.get('audio_sink'),
        'steps':steps,
    }


'''
if "def hts_ensure_on_safe():" not in s:
    i=s.index("def pipeline(open_music=False):")
    s=s[:i]+safe_fn+s[i:]

new_pipeline=r'''def pipeline(open_music=False):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f'tv-hts-bluetooth-pipeline-{time.strftime("%Y%m%d-%H%M%S")}.json'
    steps=[]
    ok, failure = preflight(steps)
    if not ok:
        payload = {'ok':False,'state':failure,'failure':failure,'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 503, write_state(payload)

    # Bring up the receiver/audio side FIRST. This makes HTS recovery independent
    # of TV state and gives HDMI-CEC its best chance to wake the Grundig.
    hts = prepare_hts_bluetooth(steps)
    if hts.get('hts_input') == 'failed':
        payload={'ok':False,'state':hts.get('failure'),'failure':hts.get('failure'),
                 'hts_power':hts.get('hts_power'),'hts_input':'failed',
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500, write_state(payload)

    audio = connect_audio(steps)
    if not audio.get('ok'):
        payload={'ok':False,'state':audio.get('failure'),'failure':audio.get('failure'),
                 'hts_power':hts.get('hts_power'),'hts_input':hts.get('hts_input'),
                 'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500, write_state(payload)

    time.sleep(0.6)
    tv_power = ensure_tv_on(steps)
    if tv_power.get('state') != 'confirmed_on':
        payload={'ok':False,'state':'TV_POWER_NOT_CONFIRMED','failure':'TV_POWER_NOT_CONFIRMED',
                 'tv_power':'failed','hts_power':'confirmed_on_by_active_bluetooth',
                 'hts_input':'confirmed_bluetooth_by_active_connection',
                 'bluetooth_connected':True,'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 504, write_state(payload)

    tv_input = set_hdmi3(steps)
    if tv_input.get('state') != 'confirmed_hdmi3':
        payload={'ok':False,'state':'HDMI3_NAVIGATION_FAILED','failure':'HDMI3_NAVIGATION_FAILED',
                 'tv_power':'confirmed_on','tv_input':tv_input.get('state'),
                 'tv_input_verification':tv_input.get('verification'),
                 'hts_power':'confirmed_on_by_active_bluetooth',
                 'hts_input':'confirmed_bluetooth_by_active_connection',
                 'bluetooth_connected':True,'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 500, write_state(payload)

    display = arm_s5_display(steps)
    physical = 'machine_path_verified_audio_not_audibly_sampled'
    markers=['RESULT=TV_POWER_CONFIRMED','RESULT=TV_HDMI3_CONFIRMED',
             'RESULT=HTS_BLUETOOTH_CONFIRMED','RESULT=ACER_HTS_BLUETOOTH_CONNECTED',
             'RESULT=SAMSUNG_AUDIO_SINK_DEFAULT','RESULT=AUDIO_STREAMS_MOVED']
    spotify=None
    if open_music:
        spotify=open_spotify(); steps.append({'stage':'optional','action':'open_spotify','result':spotify})
    aj=audio['result']
    payload={'ok':True,'state':'connected_verified','tv_power':'confirmed_on',
             'tv_input':tv_input.get('state'),'tv_input_verification':tv_input.get('verification'),
             'tv_input_needs_visible_confirmation':tv_input.get('needs_visible_confirmation', False),
             'hts_power':'confirmed_on_by_active_bluetooth',
             'hts_input':'confirmed_bluetooth_by_active_connection',
             'bluetooth_device':aj.get('bluetooth_device','SamsungHTS-8B063B'),
             'bluetooth_mac':aj.get('bluetooth_mac'),'bluetooth_connected':True,
             'audio_sink_present':True,'audio_sink':aj.get('audio_sink'),
             'audio_sink_default':True,'streams_moved':aj.get('streams_moved', True),
             'moved_sink_inputs':aj.get('moved_sink_inputs'),'physical_audio_test':physical,
             's5_display_mode':'temporary_after_remote_use','s5_display_timeout_minutes':15,
             's5_display_timer_reset':display.get('ok',False),'s5_permanent_wakelock':False,
             's5_display_sleep_verified':False,'s5_ir_after_sleep_verified':False,
             'steps':steps,'optional_spotify':spotify,'log':str(log_path),'result_markers':markers}
    log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return 200, write_state(payload)


'''
a=s.index("def pipeline(open_music=False):")
b=s.index("# C720P_TV_SURROUND_ASYNC_PIPELINE_V1",a)
s=s[:a]+new_pipeline+s[b:]

route_marker="""        if path == '/pipeline/bluetooth-fast':
"""
route_code="""        if path == '/hts/ensure-on-safe':
            status,payload=hts_ensure_on_safe(); return respond(self,status,payload)
"""
if route_code not in s:
    if route_marker not in s: raise SystemExit("POST route marker missing")
    s=s.replace(route_marker,route_code+route_marker,1)

HELPER.write_text(s)

u=UI.read_text()
u=u.replace('data-controls-version="C720P_TV_SURROUND_ACTIONS_V9_TRUTHFUL_STATE"',
            'data-controls-version="C720P_TV_SURROUND_ACTIONS_V10_SAFE_HTS_COLDSTART"')
old='''  if(S.hts==="unknown"){
    S.busyHts=true;render();status("Sending one HTS power toggle…");
    const r=await req("/ht-e6500/power","POST",7000);
    S.busyHts=false;S.hts="unknown";render();
    status(r.ok?"HTS power toggle sent · state is not independently observable":"HTS power toggle failed");
    setTimeout(()=>{refreshHTS().then(render).catch(()=>{})},1200);
    return
  }'''
new='''  if(S.hts==="unknown"){
    S.busyHts=true;render();status("Safely bringing HTS to Bluetooth…");
    const r=await reqBluetooth("/hts/ensure-on-safe","POST",45000);
    const connected=!!(r.ok&&r.data&&r.data.bluetooth_connected);
    S.busyHts=false;S.hts=connected?"on":"unknown";render();
    status(connected?"HTS on · Bluetooth verified":r.data&&r.data.failure?"HTS not verified · "+r.data.failure:"HTS power/source attempt not verified");
    setTimeout(()=>{refreshHTS().then(render).catch(()=>{})},900);
    return
  }'''
if old in u:
    u=u.replace(old,new,1)
elif new not in u:
    raise SystemExit("HTS unknown UI block missing")
UI.write_text(u)

subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("RESULT=V874_HTS_COLDSTART_PATCHED")
