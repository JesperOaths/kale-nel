#!/usr/bin/env python3
"""Fix Samsung HTS powered-on status when Bluetooth and LAN signals are absent.
The trusted user's reported physical ON state is clearly marked and expires
after eight hours; all power toggles remain guarded. No device power action.
"""
from pathlib import Path
import datetime, json, re, shutil, subprocess, sys
BASE=Path('/home/jespern/c720p-home-hub')
SERVER=BASE/'bin/ht-e6500-surround-server.py'
WWW=Path('/opt/homeassistant/config/www')
UI=WWW/'c720p-tv-surround-v21.html'
ROW=WWW/'c720p-weather-row.html'
MARK='C720P_HTS_USER_REPORTED_POWER_V124'
src=SERVER.read_text()
ui=UI.read_text()
row=ROW.read_text()
if MARK in src and MARK in ui:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)

def replace_once(s,a,b,what):
 assert s.count(a)==1, what+': anchor count '+str(s.count(a))
 return s.replace(a,b,1)

# Preserve user-reported physical ON as a *reported* state, not proof of a
# Bluetooth or LAN connection. Never infer OFF merely from no Bluetooth.
src=replace_once(src,
'''    # C720P_HTS_OFF_FAST_FINAL_V1052
''',
'''    # C720P_HTS_USER_REPORTED_POWER_V124
    # Receiver Bluetooth may disappear in DVD/AUX/HDMI source modes despite
    # the unit being physically ON. A recent explicit user confirmation is a
    # bounded, separately labelled power-state observation (not LAN proof).
    user_reported_on = bool(
        shadow_state == "on"
        and shadow.get("source") == "user_confirmed_on"
        and shadow_age is not None and shadow_age <= 8 * 3600
    )
    # C720P_HTS_OFF_FAST_FINAL_V1052
''','status provenance')
src=replace_once(src,
'''    if verified_off_shadow:
        power_state="off"
    elif live_present:
        power_state="on"
    else:
        power_state="unknown"
''',
'''    if verified_off_shadow:
        power_state="off"
        power_source="verified_off_shadow"
    elif live_present:
        power_state="on"
        power_source="live_receiver_presence"
    elif user_reported_on:
        power_state="on"
        power_source="user_confirmed_on"
    else:
        power_state="unknown"
        power_source="unobservable"
''','status override')
src=replace_once(src,
'''        "power_state":power_state,
        "live_present":live_present,
''',
'''        "power_state":power_state,
        "power_source":power_source,
        "user_reported_on":user_reported_on and not live_present,
        "live_present":live_present,
''','status fields')

src=replace_once(src,
'''    before_on = before_state == "on"

    # C720P_HTS_STALE_INTERLOCK_RECOVERY_V2
''',
'''    before_on = before_state == "on"

    # The receiver was explicitly confirmed ON by the user; another ON
    # request must never toggle its IR power key just because BT is missing.
    if want_on and before.get("user_reported_on"):
        return {
            "ok": True, "confirmed": False, "reported": True,
            "state": "on_reported", "action": "none_user_reported_already_on",
            "wanted": wanted, "presence_before": before,
            "guard": "no_double_toggle_for_user_reported_on",
        }

    # C720P_HTS_STALE_INTERLOCK_RECOVERY_V2
''','idempotent ON')

# Absence-after-off is only evidence if receiver WAS visible before OFF.
src=replace_once(src,
'''            if not bool(net_final.get("present")) and not samsung_sink_present:
                confirmed = True
                break
''',
'''            before_net = before.get("network") if isinstance(before.get("network"), dict) else {}
            before_observable = bool(
                before.get("live_present") or before.get("connected")
                or before.get("bluetooth_present") or before_net.get("present")
            )
            if before_observable and not bool(net_final.get("present")) and not samsung_sink_present:
                confirmed = True
                break
''','no false off confirmation')

src=replace_once(src,
'''                "source": "receiver_live_presence_or_commanded_shadow",
                "presence": presence,
''',
'''                "source": presence.get("power_source") or "receiver_live_presence_or_commanded_shadow",
                "reported": bool(presence.get("user_reported_on")),
                "presence": presence,
''','GET provenance')
src=replace_once(src,
'''    def do_POST(self):
        path = urlparse(self.path).path
        # C720P_TV_SURROUND_FASTPATH_V1
''',
'''    def do_POST(self):
        path = urlparse(self.path).path
        # C720P_HTS_USER_REPORTED_POWER_V124
        if path == "/ht-e6500/confirm-on":
            # Explicit physical state report. This route NEVER emits IR.
            _write_hts_power_shadow("on", "user_confirmed_on")
            p=receiver_present(fast=True)
            return respond(self, 200, {
                "ok": True, "reported": True, "emitted_ir": False,
                "state": "on", "confirmed_live": bool(p.get("live_present")),
                "source": p.get("power_source"), "expires_in_seconds": 28800,
            })
        # C720P_TV_SURROUND_FASTPATH_V1
''','POST confirmation endpoint')

# Small explicit calibration control; the central status stays truthful.
ui=replace_once(ui,
'''.pill.on{
''',
'''#htsSync{
  appearance:none;border:1px solid rgba(255,159,50,.32);
  border-radius:99px;padding:4px 6px;background:rgba(255,159,50,.10);
  color:#ffd8a3;font-size:9px;font-weight:800;line-height:1;
  cursor:pointer;white-space:nowrap
}
#htsSync:disabled{opacity:.45;cursor:wait}
.pill.on{
''','calibrate styling')
ui=replace_once(ui,
'''<div id="htsPill" class="pill unknown">HTS ?</div><div id="bridgePill"''',
'''<div id="htsPill" class="pill unknown">HTS ?</div><button type="button" id="htsSync" title="Confirm that the Samsung receiver is physically ON">Set ON</button><div id="bridgePill"''','calibrate DOM')
ui=replace_once(ui,
'''const e={hts:$("hts"),tv:$("tv"),''',
'''const e={hts:$("hts"),htsSync:$("htsSync"),tv:$("tv"),''','calibrate ref')
ui=replace_once(ui,
'''let busy=false,tvState=null,htsState=null,irReady=false,mediaReady=false;''',
'''let busy=false,tvState=null,htsState=null,htsReported=false,irReady=false,mediaReady=false;''','state var')
ui=replace_once(ui,
'''  e.tv.disabled=busy;e.spotify.disabled=busy;''',
'''  e.tv.disabled=busy;e.spotify.disabled=busy;e.htsSync.disabled=busy;''','sync busy')
ui=replace_once(ui,
'''  htsState=ht&&typeof ht.is_on==="boolean"?ht.is_on:null;
  irReady=''',
'''  htsState=ht&&typeof ht.is_on==="boolean"?ht.is_on:null;
  htsReported=!!(ht&&ht.reported&&htsState===true);
  irReady=''','state source')
ui=replace_once(ui,
'''  pill(e.htsP,"HTS",htsState);
''',
'''  pill(e.htsP,"HTS",htsState);
  if(htsReported){
    e.htsP.textContent="HTS ON (reported)";
    e.htsP.title="You confirmed the receiver is powered on; Bluetooth/network is not independently reporting its power state";
  }else e.htsP.title="";
''','pill reported')
ui=replace_once(ui,
'''  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",irReady?"Samsung HT-E6500":s5Problem);''',
'''  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",
        htsReported?"Power ON confirmed by you · no Bluetooth detection":
        irReady?(htsState===null?"Power state unknown · IR toggle possible":"Samsung HT-E6500"):s5Problem);''','HTS btn label')
ui=replace_once(ui,
'''e.hts.onclick=()=>action(htsState===true?"Turning HTS Off":"Turning HTS On",async()=>{''',
'''// C720P_HTS_USER_REPORTED_POWER_V124
e.htsSync.onclick=()=>action("Confirming HTS already ON",
  ()=>req(8789,"/ht-e6500/confirm-on","POST",10000),150);
e.hts.onclick=()=>action(htsState===true?"Turning HTS Off":"Turning HTS On",async()=>{''','sync click')
old_link=re.search(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',row)
assert old_link is not None
ts=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
row=row[:old_link.start()]+('/local/c720p-tv-surround-v21.html?v=HTS_REPORT_ON_V124_'+ts)+row[old_link.end():]
assert src.count(MARK)==2
assert ui.count(MARK)==1
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'user_reported_with_provenance':True,'bounded_eight_hours':True,
 'no_power_toggle_for_reported_ON':True,'explicit_sync_control':True,'no_false_off_confirmation':True,'all_anchors':True}))
 sys.exit(0)
back=Path('/home/jespern/c720p-backups')/('hts-reported-on-v124-'+ts)
back.mkdir(parents=True,exist_ok=False)
for p in (SERVER,UI,ROW):shutil.copy2(p,back/(p.name+'.before'))
try:
 for p,text in ((SERVER,src),(UI,ui),(ROW,row)):
  mode=p.stat().st_mode;p.write_text(text);p.chmod(mode)
 ck=subprocess.run(['python3','-m','py_compile',str(SERVER)],capture_output=True,text=True,timeout=15)
 if ck.returncode:raise RuntimeError(ck.stderr)
 restart=subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],capture_output=True,text=True,timeout=20)
 if restart.returncode:raise RuntimeError(restart.stderr)
 print(json.dumps({'ok':True,'version':'V124','backup':str(back),'server_restarted':True,'ui_cache_busted':True}))
except BaseException:
 for p in (SERVER,UI,ROW):shutil.copy2(back/(p.name+'.before'),p)
 subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],timeout=20)
 raise
