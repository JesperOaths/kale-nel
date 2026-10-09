#!/usr/bin/env python3
"""Require explicit two-press action for unobservable HTS power toggles.
No IR command is sent by this patch. Updates one server and UI, with rollback.
"""
from pathlib import Path
import datetime,re,json,shutil,subprocess,sys
B=Path('/home/jespern/c720p-home-hub')
S=B/'bin/ht-e6500-surround-server.py'
W=Path('/opt/homeassistant/config/www')
U=W/'c720p-tv-surround-v21.html'
ROW=W/'c720p-weather-row.html'
s=S.read_text();u=U.read_text();row=ROW.read_text()
MARK='C720P_HTS_UNKNOWN_POWER_INTERLOCK_V125'
if MARK in s and MARK in u:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
def change(text,a,b,name):
 assert text.count(a)==1,(name,text.count(a))
 return text.replace(a,b,1)
s=change(s,
'def ensure_hts_power(want_on):',
'def ensure_hts_power(want_on, allow_unknown_power_toggle=False):\n    # C720P_HTS_UNKNOWN_POWER_INTERLOCK_V125',
'function signature')
s=change(s,
'''        recovery_allowed = explicit_off_recovery_allowed or stale_recovery_allowed''',
'''        recovery_allowed = bool(allow_unknown_power_toggle and (explicit_off_recovery_allowed or stale_recovery_allowed))''',
'stale interlock permission')
s=change(s,
'''        if not (want_on and no_live_evidence):
            return {''',
'''        if not (want_on and no_live_evidence and allow_unknown_power_toggle):
            return {''',
'unknown power automatic guard')
s=change(s,
'''                "action": "refused_unknown_power_state", "wanted": wanted,''',
'''                "action": "refused_unknown_power_state", "wanted": wanted,
                "error": "power_state_unobservable_requires_explicit_toggle",''',
'unknown error reason')
# A raw/unconfirmed off shadow is not evidence that the receiver is off.
s=change(s,
'''    if bool(before.get("shadow_fresh")) and commanded_state == "off":
        if want_on:
            before_state = "off"
''',
'''    if bool(before.get("shadow_fresh")) and commanded_state == "off":
        if want_on and before.get("power_source") != "verified_off_shadow" and not allow_unknown_power_toggle:
            return {
                "ok": False, "confirmed": False, "state": "unknown",
                "error": "unverified_off_shadow_requires_explicit_toggle",
                "action": "refused_unverified_off_shadow",
                "wanted": wanted, "presence_before": before,
            }
        if want_on:
            before_state = "off"
''',
'guard unverified off')
s=change(s,
'''        if path in {"/ht-e6500/on", "/ht-e6500/ensure-on"}:
''',
'''        if path == "/ht-e6500/force-on-unknown":
            # User explicitly double-confirmed one unverified IR power toggle.
            result = ensure_hts_power(True, allow_unknown_power_toggle=True)
            return respond(self, 200 if result.get("ok") else 500, result)
        if path in {"/ht-e6500/on", "/ht-e6500/ensure-on"}:
''',
'explicit route')

u=change(u,
'''let busy=false,tvState=null,htsState=null,htsReported=false,irReady=false,mediaReady=false;''',
'''let busy=false,tvState=null,htsState=null,htsReported=false,irReady=false,mediaReady=false;
let htsUnknownArmUntil=0; // C720P_HTS_UNKNOWN_POWER_INTERLOCK_V125''',
'ui guard state')
u=change(u,
'''  label(e.hts,htsState===true?"Turn HTS Off":"Turn HTS On",
        htsReported?"Power ON confirmed by you · no Bluetooth detection":
        irReady?(htsState===null?"Power state unknown · IR toggle possible":"Samsung HT-E6500"):s5Problem);''',
'''  label(e.hts,htsState===true?"Turn HTS Off":htsState===false?"Turn HTS On":"HTS state unknown",
        htsReported?"Power ON confirmed by you · no Bluetooth detection":
        irReady?(htsState===null?"First tap warns · second tap sends one IR toggle":"Samsung HT-E6500"):s5Problem);
  if(htsState===null && Date.now()<htsUnknownArmUntil)
    label(e.hts,"Tap again to send IR","Unknown state · may switch an ON receiver OFF");''',
'ui label')
u=change(u,
'''e.hts.onclick=()=>action(htsState===true?"Turning HTS Off":"Turning HTS On",async()=>{
  if(!irReady)await ensureIR();
  return req(8789,htsState===true?"/ht-e6500/ensure-off":"/ht-e6500/ensure-on","POST",36000);
},1800);''',
'''e.hts.onclick=()=>{
  const unknown=htsState===null;
  if(unknown && Date.now()>=htsUnknownArmUntil){
    htsUnknownArmUntil=Date.now()+12000;
    label(e.hts,"Tap again to send IR","Unknown state · may switch an ON receiver OFF");
    status("HTS state undetectable. Tap again within 12s to send ONE power toggle, or select Set ON if already powered.", "bad");
    return;
  }
  htsUnknownArmUntil=0;
  action(htsState===true?"Turning HTS Off":unknown?"Sending one confirmed HTS power toggle":"Turning HTS On",async()=>{
    if(!irReady)await ensureIR();
    const route=htsState===true?"/ht-e6500/ensure-off":
      unknown?"/ht-e6500/force-on-unknown":"/ht-e6500/ensure-on";
    return req(8789,route,"POST",36000);
  },1800);
};''',
'two press handler')
m=re.search(r'/local/c720p-tv-surround-v21\.html\?v=[^"]+',row)
assert m
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
row=row[:m.start()]+('/local/c720p-tv-surround-v21.html?v=HTS_SAFE_UNKNOWN_V125_'+stamp)+row[m.end():]
assert s.count(MARK)==1 and u.count(MARK)==1
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'no_auto_unknown_toggle':True,
 'explicit_two_click_toggle':True,'unverified_off_guard':True}))
 sys.exit(0)
backup=Path('/home/jespern/c720p-backups')/('hts-unknown-interlock-v125-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
for p in (S,U,ROW):shutil.copy2(p,backup/(p.name+'.before'))
try:
 for p,t in ((S,s),(U,u),(ROW,row)):
  mode=p.stat().st_mode;p.write_text(t);p.chmod(mode)
 ck=subprocess.run(['python3','-m','py_compile',str(S)],capture_output=True,text=True,timeout=15)
 if ck.returncode:raise RuntimeError(ck.stderr)
 r=subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],capture_output=True,text=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr)
 print(json.dumps({'ok':True,'installed':True,'version':'V125','backup':str(backup)},indent=2))
except BaseException:
 for p in (S,U,ROW):shutil.copy2(backup/(p.name+'.before'),p)
 subprocess.run(['systemctl','--user','restart','ht-e6500-surround.service'],timeout=25)
 raise
