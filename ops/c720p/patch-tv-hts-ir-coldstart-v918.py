#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess,re,urllib.request,tempfile

# V919_BOOTSTRAP_BEGIN
try:
    v919_url="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p/patch-network-selfheal-v919.py"
    v919_path=Path(tempfile.gettempdir())/"patch-network-selfheal-v919.py"
    with urllib.request.urlopen(v919_url,timeout=25) as r:
        v919_path.write_bytes(r.read())
    subprocess.run(["python3",str(v919_path)],check=True,timeout=120)
    print("V919_BOOTSTRAP=APPLIED")
except Exception as e:
    print("V919_BOOTSTRAP=DEGRADED",repr(e))
# V919_BOOTSTRAP_END

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
SERVER=BASE/"bin/ht-e6500-surround-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v918-tv-hts-ir-coldstart-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,SERVER,UI):
    shutil.copy2(p,BACK/(p.name+".before"))

# ---- Restore a real single-shot Grundig cold wake via the now-confirmed S5 IR ----
s=SERVER.read_text()
old=r'''    # Certified wake transports have been tested on this exact Grundig:
    # Android-TV remote is unreachable in standby, Wake-on-LAN does not wake it,
    # and the recovered S5 Grundig IR profiles do not wake this set.  Do not
    # spend 20+ seconds on a dead Wi-Fi path or claim a false success.
    if want_on and before.get("state") == "off":
        return {
            "ok": False, "confirmed": False, "state": "off",
            "action": "wake_transport_unavailable", "wanted": wanted,
            "error": "tv_wake_transport_unavailable",
            "power_state_before": before,
            "tested_transports": ["androidtv_remote_standby", "wake_on_lan", "s5_recovered_grundig_ir_profiles"],
            "guard": "fail_fast_no_false_success",
        }
'''
new=r'''    # S5 IR hardware has been physically re-verified. From a confirmed OFF
    # state, send exactly one Grundig power frame and verify wake over the
    # paired Android-TV remote. Never blind-double-toggle.
    if want_on and before.get("state") == "off":
        sent = send_ir("grundig_power", device="grundig_tv")
        if not sent.get("ok"):
            return {
                "ok": False, "confirmed": False, "state": "off",
                "action": "single_s5_ir_wake_failed", "wanted": wanted,
                "power_state_before": before, "power_result": sent,
                "power_transport": "s5_ir",
                "guard": "single_signal_only_no_automatic_retry",
            }
        checks=[]
        after=None
        confirmed=False
        deadline=time.monotonic()+16.0
        time.sleep(1.2)
        while True:
            after=grundig_fast_power_state()
            checks.append(after)
            if after.get("state") == "on":
                confirmed=True
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.55)
        return {
            "ok": bool(sent.get("ok")), "confirmed": confirmed,
            "state": "on" if confirmed else "unknown",
            "action": "single_s5_ir_power_on",
            "wanted": wanted,
            "power_state_before": before,
            "power_state_after": after,
            "verification_checks": checks,
            "power_result": sent,
            "power_transport": "s5_ir",
            "guard": "single_signal_only_no_automatic_retry",
        }
'''
if old in s:
    s=s.replace(old,new,1)
elif "single_s5_ir_power_on" not in s:
    raise SystemExit("Grundig fail-fast block not found")
SERVER.write_text(s)

# ---- Restore HTS cold-start orchestration while preserving current prepare/connect logic ----
s=HELPER.read_text()

safe_fn=r'''def hts_ensure_on_safe():
    """HTS-only cold-start path. Current prepare_hts_bluetooth() owns the
    single-toggle/source-search policy; this wrapper must not pre-reject a
    cold or temporarily unobservable receiver."""
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
        'audio_sink':live.get('audio_sink'),'steps':steps,
    }


'''
a=s.index("def hts_ensure_on_safe():")
b=s.index("def pipeline(open_music=False):",a)
s=s[:a]+safe_fn+s[b:]

pipeline_fn=r'''def pipeline(open_music=False):
    """Requested deterministic order: TV wake -> HDMI3 -> HTS BT -> C720P audio."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f'tv-hts-bluetooth-pipeline-{time.strftime("%Y%m%d-%H%M%S")}.json'
    steps=[]
    ok,failure=preflight(steps)
    if not ok:
        payload={'ok':False,'state':failure,'failure':failure,'steps':steps,'log':str(log_path)}
        log_path.write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        return 503,write_state(payload)

    tv_power=ensure_tv_on(steps)
    if tv_power.get('state')!='confirmed_on':
        payload={'ok':False,'state':'TV_POWER_NOT_CONFIRMED','failure':'TV_POWER_NOT_CONFIRMED',
                 'tv_power':tv_power.get('state'),'steps':steps,'log':str(log_path)}
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
s=s[:a]+pipeline_fn+s[b:]

async_fn=r'''def start_pipeline_async(open_music=False):
    global _PIPELINE_RUNNING
    with _PIPELINE_LOCK:
        if _PIPELINE_RUNNING:
            return 202, {"ok":True,"state":"pipeline_running","already_running":True}
        _PIPELINE_RUNNING=True
        write_state({"ok":True,"state":"pipeline_running","started_at":time.time(),"cold_start_enabled":True})
        t=threading.Thread(target=_pipeline_worker,args=(open_music,),daemon=True,name="c720p-media-coldstart")
        t.start()
        return 202,{"ok":True,"state":"pipeline_started","thread":t.name,"cold_start_enabled":True}


'''
a=s.index("def start_pipeline_async(open_music=False):")
b=s.index("\n\nclass Handler",a)
s=s[:a]+async_fn+s[b:]
HELPER.write_text(s)

# ---- UI: remove the v910 TV-off interlock; keep truthful error feedback ----
u=UI.read_text()
u=u.replace('data-controls-version="C720P_TV_SURROUND_ACTIONS_V12_FASTSTART_TRUTHFUL"',
            'data-controls-version="C720P_TV_SURROUND_ACTIONS_V13_IR_COLDSTART_RESTORED"')
u=re.sub(
    r'''  try\{await Promise\.all\(\[refreshTV\(\),refreshHTS\(\)\]\)\}catch\(_\)\{\}\n  render\(\);\n  if\(S\.tv==="off"\)\{\n    S\.busyMacro=false;render\(\);\n    status\("TV is off · cold wake is currently unavailable; no background retry started"\);\n    return\n  \}\n''',
    '''  try{await Promise.all([refreshTV(),refreshHTS()])}catch(_){}\n  render();\n''',
    u,count=1)
UI.write_text(u)

subprocess.run(["python3","-m","py_compile",str(HELPER),str(SERVER)],check=True)
subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service","c720p-bluetooth-helper.service"],check=True)
time.sleep(2)
print("BACKUP="+str(BACK))
print("RESULT=V918_IR_COLDSTART_RESTORED")
