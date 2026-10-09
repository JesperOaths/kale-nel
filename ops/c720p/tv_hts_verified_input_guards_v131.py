#!/usr/bin/env python3
"""Fail-closed fix for C720P TV/HTS. Does not transmit IR or TV power.
Requires --apply to make changes; takes backups; syntax-checks before restart.
"""
from pathlib import Path
import datetime,json,shutil,subprocess,sys,os
home=Path("/home/jespern")
base=home/"c720p-home-hub"
b=base/"bin/ht-e6500-surround-server.py"
c=base/"bin/c720p-samsung-bluetooth-connect.sh"
f=Path("/opt/homeassistant/config/www/c720p-tv-surround-v21.html")
w=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
files=[b,c,f,w]
for p in files[:3]:assert p.is_file(),p
MARK="C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131"
if MARK in b.read_text():
 print(json.dumps({"ok":True,"already_applied":True}));sys.exit(0)
def exact(s,old,new,expected=1,name=""):
 n=s.count(old)
 if n!=expected:raise AssertionError(f"Unexpected {name} anchor count {n} expected {expected}: {old[:90]}")
 return s.replace(old,new)
s=b.read_text()
s=exact(s,'and shadow_age is not None and shadow_age <= 8 * 3600','and shadow_age is not None and shadow_age <= 5 * 60',name="reported ON max TTL")
s=exact(s,'''    # C720P_HTS_OFF_FAST_FINAL_V1052''','''    # C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
    # A user physically reporting OFF takes precedence over an old ON status,
    # but never override real Bluetooth/network live presence.
    user_reported_off = bool(
        shadow_state == "off"
        and shadow.get("source") == "user_confirmed_off"
        and shadow_age is not None and shadow_age <= 5 * 60
    )
    # C720P_HTS_OFF_FAST_FINAL_V1052''',name="off reporting")
s=exact(s,'''    elif user_reported_on:
        power_state="on"
        power_source="user_confirmed_on"
    else:''','''    elif user_reported_off:
        power_state="off"
        power_source="user_confirmed_off"
    elif user_reported_on:
        power_state="on"
        power_source="user_confirmed_on"
    else:''',name="power report selection")
s=exact(s,'''        "user_reported_on":user_reported_on and not live_present,''','''        "user_reported_on":user_reported_on and not live_present,
        "user_reported_off":user_reported_off and not live_present,''',name="power presence off")
s=exact(s,'''                "reported": bool(presence.get("user_reported_on")),
                "presence": presence,''','''                "reported": bool(presence.get("user_reported_on") or presence.get("user_reported_off")),
                "reported_state": ("on" if presence.get("user_reported_on")
                                   else ("off" if presence.get("user_reported_off") else None)),
                "presence": presence,''',name="power endpoint OFF report")
s=exact(s,'''        # C720P_HTS_USER_REPORTED_POWER_V124
        if path == "/ht-e6500/confirm-on":''','''        # C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
        # Never run unverified source sweeps, menu navigation or power-first
        # surround paths until HDMI source and HTS BT READY are observable.
        unsafe_input_routes = {
            "/ht-e6500/source-input-fast", "/ht-e6500/function-fast",
            "/ht-e6500/bluetooth-mode-fast", "/ht-e6500/bluetooth-menu-fast",
            "/ht-e6500/bluetooth-mode", "/ht-e6500/bluetooth-menu",
            "/ht-e6500/source", "/ht-e6500/input", "/ht-e6500/bt",
            "/ht-e6500/bluetooth", "/ht-e6500/function",
            "/ht-e6500/surround-bluetooth",
            "/ht-e6500/open-home-theatre-auto-mac",
        }
        if path in unsafe_input_routes:
            return respond(self, 409, {
                "ok": False, "error": "HTS_INPUT_NOT_VERIFIED",
                "state": "manual_bt_ready_confirmation_required",
                "message": "FUNCTION/source_input IR input changes were not verified on "
                           "the physical receiver. source_input decodes as AUX. "
                           "Put HTS into BT READY manually; then retry pairing. "
                           "No IR or HTS power was transmitted."
            })
        if path == "/ht-e6500/confirm-off":
            _write_hts_power_shadow("off","user_confirmed_off")
            p=receiver_present(fast=True)
            return respond(self, 200, {
                "ok":True,"state":"off","reported":True,
                "confirmed_live":False,"emitted_ir":False,
                "source":p.get("power_source"),"expires_in_seconds":300,
            })
        # C720P_HTS_USER_REPORTED_POWER_V124
        if path == "/ht-e6500/confirm-on":''',name="unsafe source route guard")
s=exact(s,'''def surround_bluetooth():
    presence = receiver_present()''','''def surround_bluetooth():
    # C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
    # Old route could send POWER just because Bluetooth is disconnected.
    # The HTS is unobservable in DVD/D.IN and that inference is unsafe.
    return {"ok":False,"state":"manual_bt_ready_confirmation_required",
            "error":"HTS_INPUT_NOT_VERIFIED","emitted_ir":False,
            "message":"Unverified power-first Bluetooth macro disabled."}
    presence = receiver_present()''',name="power-first route")
s=exact(s,'''def hts_bluetooth_mode_fast():
    power = ensure_hts_power(True)''','''def hts_bluetooth_mode_fast():
    # C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
    return {"ok":False,"state":"manual_bt_ready_confirmation_required",
            "error":"HTS_INPUT_NOT_VERIFIED","emitted_ir":False}
    power = ensure_hts_power(True)''',name="fast bluetooth path")
t=c.read_text()
t=exact(t,'''SOURCE_CYCLES=8''','''# C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
# source_input IR code is *identical to AUX*; FUNCTION was reported to
# power the receiver off. Stop unverified input sweeps.
SOURCE_CYCLES=0''',name="disable HTS source input sweeps")
t=exact(t,'''if ! transport_ready; then
  # C720P_HTS_MENU_EXIT_GUARD_V1052''','''# C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
# Auto-reconnect may retry an already-paired, already-ready BT receiver, but
# never automatically press FUNCTION or POWER when it is not discoverable.
if ! transport_ready; then
  fail SAMSUNG_BT_READY_NOT_VERIFIED "Receiver does not have a verified BT audio sink. Automatic FUNCTION/POWER cycling is disabled." 3
fi
if ! transport_ready; then
  # C720P_HTS_MENU_EXIT_GUARD_V1052''',name="fail-closed BT connector")
h=f.read_text()
h=exact(h,'''#htsSync{''','''#htsSync,#htsSyncOff{''',name="buttons style")
h=exact(h,'''#htsSync:disabled{opacity:.45;cursor:wait}''','''#htsSync:disabled,#htsSyncOff:disabled{opacity:.45;cursor:wait}
#htsSyncOff{color:#ffcad0;border-color:rgba(250,120,132,.32);background:rgba(250,120,132,.08)}''',name="off style")
h=exact(h,'''id="htsSync" title="Confirm that the Samsung receiver is physically ON">Set ON</button>''','''id="htsSync" title="Confirm that the Samsung receiver is physically ON">Set ON</button><button type="button" id="htsSyncOff" title="Confirm that the Samsung receiver is physically OFF">Set OFF</button>''',name="off button")
h=exact(h,'''htsSync:$("htsSync"),tv:''','''htsSync:$("htsSync"),htsSyncOff:$("htsSyncOff"),tv:''',name="JS element")
h=exact(h,'''e.tv.disabled=busy;e.spotify.disabled=busy;e.htsSync.disabled=busy;''','''e.tv.disabled=busy;e.spotify.disabled=busy;e.htsSync.disabled=busy;e.htsSyncOff.disabled=busy;''',name="disable busy")
h=exact(h,'''htsReported=!!(ht&&ht.reported&&htsState===true);''','''htsReported=!!(ht&&ht.reported&&htsState===true);
  const htsReportedOff=!!(ht&&ht.reported&&htsState===false);''',name="OFF display variable")
h=exact(h,'''    e.htsP.title="You confirmed the receiver is powered on; Bluetooth/network is not independently reporting its power state";
  }else e.htsP.title="";''','''    e.htsP.title="User reported ON within 5 minutes. No physical power sensor.";
  }else if(htsReportedOff){
    e.htsP.textContent="HTS OFF (reported)";
    e.htsP.title="User reported OFF within 5 minutes. No physical power sensor.";
  }else e.htsP.title="";''',name="OFF status pill")
h=exact(h,'''e.htsSync.onclick=()=>action("Confirming HTS already ON",
  ()=>req(8789,"/ht-e6500/confirm-on","POST",10000),150);''','''e.htsSync.onclick=()=>action("Confirming physically ON · expires after 5 minutes",
  ()=>req(8789,"/ht-e6500/confirm-on","POST",10000),150);
// C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
e.htsSyncOff.onclick=()=>action("Confirming physically OFF · no IR transmitted",
  ()=>req(8789,"/ht-e6500/confirm-off","POST",10000),150);''',name="report-off click")
h=exact(h,'''e.macro.onclick=async()=>{''','''e.macro.onclick=async()=>{
  // C720P_TV_HTS_VERIFIED_INPUT_GUARDS_V131
  // The receiver must already be in BT READY; the backend refuses blind
  // source sweeps. Do not display an unverified HDMI input as successful.''',name="macro guard comment")
h=exact(h,'''    status("Connecting Samsung receiver over Bluetooth…");''','''    status("Attempting Bluetooth link · HTS must already display BT READY…");''',name="macro state")
h=exact(h,'''    if(!verified)throw new Error("Bluetooth audio could not be verified");''','''    if(!verified)throw new Error("Bluetooth not verified · check HTS BT READY and TV HDMI3");''',name="macro failure")
# Invalidate iframe cache with a unique marker, without touching unrelated dashboard.
ws=None
if w.is_file():
 ws=w.read_text()
 import re
 pat=r'(c720p-tv-surround-v21\.html\?v=)[a-zA-Z0-9_\-]+'
 ws,n=re.subn(pat,r'\g<1>HTS_VERIFIED_INPUT_GUARDS_V131_20261009',ws)
 if n==0:
  ws=ws.replace('c720p-tv-surround-v21.html','c720p-tv-surround-v21.html?v=HTS_VERIFIED_INPUT_GUARDS_V131_20261009')
if '--apply' not in sys.argv:
 print(json.dumps({"ok":True,"dry_run":True,"marker":MARK,"files":{str(b):len(s),str(c):len(t),str(f):len(h),str(w):len(ws or '')},"unsafe_source_ir_disabled":True,"reported_on_ttl_seconds":300,"user_reported_off_added":True},indent=2))
 sys.exit(0)
dt=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
back=home/'c720p-backups'/('tv-hts-verified-input-guards-v131-'+dt)
back.mkdir(parents=True)
changed={b:s,c:t,f:h}
if ws and w.is_file() and ws!=w.read_text():changed[w]=ws
for path in changed:
 dest=back/(path.name+'.before')
 shutil.copy2(path,dest)
try:
 for path,contents in changed.items():
  orig_mode=path.stat().st_mode
  path.write_text(contents)
  path.chmod(orig_mode)
 a=subprocess.run(['python3','-m','py_compile',str(b)],capture_output=True,text=True,timeout=25)
 assert a.returncode==0,a.stderr
 z=subprocess.run(['bash','-n',str(c)],capture_output=True,text=True,timeout=10)
 assert z.returncode==0,z.stderr
 assert MARK in b.read_text() and MARK in c.read_text() and MARK in f.read_text()
 # The old timer retries Bluetooth repeatedly without ensuring the receiver
 # is in BT READY; terminate its future launches, preserve its script/state.
 timer=subprocess.run(['systemctl','--user','disable','--now','c720p-surround-pending-recovery.timer'],capture_output=True,text=True,timeout=15)
 assert timer.returncode==0,timer.stderr
 svc=subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],capture_output=True,text=True,timeout=22)
 assert svc.returncode==0,svc.stderr
 import time
 time.sleep(1.0)
 health=subprocess.run(['systemctl','--user','is-active','ht-e6500-surround.service'],capture_output=True,text=True,timeout=7)
 assert health.stdout.strip()=='active',health.stdout
 print(json.dumps({"ok":True,"applied":True,"version":"V131","backup":str(back),"changed_files":[str(p) for p in changed],"hts_backend_service_active":True,"pending_auto_recovery_timer":"disabled","safe_failure_only_until_bt_ready":True},indent=2))
except BaseException as e:
 for path in changed: shutil.copy2(back/(path.name+'.before'),path)
 subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],capture_output=True,timeout=20)
 print(json.dumps({"ok":False,"rolled_back":True,"error":str(e)}))
 raise
