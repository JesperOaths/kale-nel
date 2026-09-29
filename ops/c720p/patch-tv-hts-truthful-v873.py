#!/usr/bin/env python3
from pathlib import Path
import shutil, time, re, subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
SERVER=BASE/"bin/ht-e6500-surround-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v873-tv-hts-truth-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(SERVER,BACK/"ht-e6500-surround-server.py.before")
shutil.copy2(UI,BACK/"c720p-tv-surround.html.before")

s=SERVER.read_text()

old='''    shadow=_read_hts_power_shadow()
    shadow_state=str(shadow.get("state") or "").lower()
    power_state="on" if live_present else (shadow_state if shadow_state in {"on","off"} else "unknown")
    present=power_state=="on"
    return {
        "ok":True,
        "present":present,
        "power_state":power_state,
        "live_present":live_present,
'''
new='''    shadow=_read_hts_power_shadow()
    shadow_state=str(shadow.get("state") or "").lower()
    try:
        shadow_age=max(0,int(time.time())-int(shadow.get("updated_at") or 0))
    except Exception:
        shadow_age=None
    shadow_fresh=bool(shadow_state in {"on","off"} and shadow_age is not None and shadow_age <= 30)

    # A command shadow is never independent evidence.  It is retained only as
    # UI/debug context.  Live network/BlueZ presence may prove ON; absence does
    # not prove OFF because this receiver can have networking/Bluetooth asleep.
    power_state="on" if live_present else "unknown"
    present=live_present
    return {
        "ok":True,
        "present":present,
        "power_state":power_state,
        "live_present":live_present,
        "commanded_state":shadow_state if shadow_fresh else None,
        "shadow_fresh":shadow_fresh,
        "shadow_age_seconds":shadow_age,
'''
if old not in s: raise SystemExit("receiver_present state block not found")
s=s.replace(old,new,1)

old2='''    # ON from standby: Android-TV remote service is unavailable, so use one IR power signal.
    # OFF from confirmed ON: prefer the paired Wi-Fi POWER key, then fall back to one IR signal.
    if want_on:
        sent = run_grundig_wifi_route("/grundig-tv/power")
        transport = "grundig_wifi"
        if not sent.get("ok"):
            sent = send_ir("grundig_power", device="grundig_tv")
            transport = "s5_ir_fallback"
    else:
        sent = run_grundig_wifi_route("/grundig-tv/power")
        transport = "grundig_wifi"
        if not sent.get("ok"):
            sent = send_ir("grundig_power", device="grundig_tv")
            transport = "s5_ir_fallback"
'''
new2='''    # Certified wake transports have been tested on this exact Grundig:
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

    # A confirmed-ON TV can still be powered off over its paired Android-TV
    # network remote.  If that path fails, do not send an unverified IR toggle.
    sent = run_grundig_wifi_route("/grundig-tv/power")
    transport = "grundig_wifi"
'''
if old2 not in s: raise SystemExit("grundig power transport block not found")
s=s.replace(old2,new2,1)

# Remove the unreachable/dead generic Grundig IR fallback after the Wi-Fi catch-all.
pat=r'''        if path.startswith\("/grundig-tv/"\):
            command = \{
                "power": "grundig_power",
                "on": "grundig_power",
                "off": "grundig_power",
                "source": "grundig_source",
                "volume-up": "grundig_volume_up",
                "volume-down": "grundig_volume_down",
                "mute": "grundig_mute",
            \}\.get\(path\.rsplit\("/", 1\)\[-1\]\)
            if command:
                result = send_ir\(command, device="grundig_tv"\)
                return respond\(self, 200 if result\.get\("ok"\) else 500, result\)
'''
s2,n=re.subn(pat,"",s,count=1)
if n!=1: raise SystemExit(f"dead Grundig fallback removal count={n}")
s=s2

SERVER.write_text(s)

u=UI.read_text()
u=u.replace('data-controls-version="C720P_TV_SURROUND_ACTIONS_V8_ADAPTIVE_BT"',
            'data-controls-version="C720P_TV_SURROUND_ACTIONS_V9_TRUTHFUL_STATE"')

old3='''  h.innerHTML=(S.busyHts?"HTS changing…":S.hts==="on"?"Turn HTS off":"Turn HTS on")+
    '<span class="sub">'+(S.busyHts?"verifying…":S.hts==="on"?"receiver detected / known on":S.hts==="off"?"receiver known off":"state unknown · safe ensure-on")+"</span>";'''
new3='''  h.innerHTML=(S.busyHts?"HTS changing…":S.hts==="on"?"Turn HTS off":S.hts==="off"?"Turn HTS on":"Toggle HTS power")+
    '<span class="sub">'+(S.busyHts?"verifying…":S.hts==="on"?"receiver detected live":S.hts==="off"?"receiver confirmed off":"state not observable · manual toggle")+"</span>";'''
if old3 not in u: raise SystemExit("UI HTS render block not found")
u=u.replace(old3,new3,1)

old4='''$("hts").onclick=async e=>{
  flash(e.currentTarget);if(S.busyHts)return;
  const target=await resolveTarget("hts");
  S.busyHts=true;render();status("Ensuring HTS "+target+"…");
  const r=await req("/ht-e6500/ensure-"+target,"POST",16000);
  const rs=r.ok&&r.data?String(r.data.state||"").toLowerCase():"unknown";
  const confirmed=!!(r.ok&&r.data&&(r.data.confirmed===true||rs===target));
  if(confirmed)S.hts=target;
  S.busyHts=false;render();
  status(confirmed?"HTS "+target+" confirmed":r.ok?"HTS command sent · checking state":"HTS command failed · no blind retry sent");
  setTimeout(()=>{refreshHTS().then(render).catch(()=>{})},750)
};'''
new4='''$("hts").onclick=async e=>{
  flash(e.currentTarget);if(S.busyHts)return;
  await refreshHTS();render();
  if(S.hts==="unknown"){
    S.busyHts=true;render();status("Sending one HTS power toggle…");
    const r=await req("/ht-e6500/power","POST",7000);
    S.busyHts=false;S.hts="unknown";render();
    status(r.ok?"HTS power toggle sent · state is not independently observable":"HTS power toggle failed");
    setTimeout(()=>{refreshHTS().then(render).catch(()=>{})},1200);
    return
  }
  const target=S.hts==="on"?"off":"on";
  S.busyHts=true;render();status("Ensuring HTS "+target+"…");
  const r=await req("/ht-e6500/ensure-"+target,"POST",16000);
  const rs=r.ok&&r.data?String(r.data.state||"").toLowerCase():"unknown";
  const confirmed=!!(r.ok&&r.data&&(r.data.confirmed===true||rs===target));
  S.hts=confirmed?target:"unknown";
  S.busyHts=false;render();
  status(confirmed?"HTS "+target+" confirmed":r.ok?"HTS command sent · state unverified":"HTS command failed · no blind retry sent");
  setTimeout(()=>{refreshHTS().then(render).catch(()=>{})},750)
};'''
if old4 not in u: raise SystemExit("UI HTS click block not found")
u=u.replace(old4,new4,1)

old5='''  status(confirmed?"TV "+target+" confirmed":r.ok?"TV command sent · checking state":"TV command failed");'''
new5='''  const why=r.data&&String(r.data.error||r.data.action||"");
  status(confirmed?"TV "+target+" confirmed":why==="tv_wake_transport_unavailable"?"TV is off · no working remote wake method is currently available":r.ok?"TV command sent · checking state":"TV command failed");'''
if old5 not in u: raise SystemExit("UI TV status block not found")
u=u.replace(old5,new5,1)

UI.write_text(u)

subprocess.run(["python3","-m","py_compile",str(SERVER)],check=True)
print(f"backup={BACK}")
print("patched=server,ui")
