#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v9-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V8 starting; one-frame strong dark walk-by trigger; no images stored',
            'FRONTCAM_MOTION_V9 starting; stricter coherent dark-motion confirmation; no images stored')
s=s.replace('"version":"frontcam-motion-v8"','"version":"frontcam-motion-v9"')
s=s.replace('FRONTCAM_MOTION_V8 stopped','FRONTCAM_MOTION_V9 stopped')

old_init='''    transition_until=0.0; transition_stable_streak=0
    latest={}
'''
new_init='''    transition_until=0.0; transition_stable_streak=0
    dark_entry_guard_until=0.0
    dark_temporal_streak=0
    latest={}
'''
if old_init not in s:
    raise SystemExit("V9 init anchor missing")
s=s.replace(old_init,new_init,1)

old_abrupt='''        if abrupt:
            bg=g.astype(np.float32)
            prev=g.copy()
            candidate_streak=0
            transition_until=now+TRANSITION_MAX_SECONDS
            transition_stable_streak=0
            candidate=False
            source="lighting-transition"
'''
new_abrupt='''        if abrupt:
            # A bright->dark jump is usually the controlled lamp being switched
            # off. Keep a longer dark-entry guard, but do not make it a blind
            # period: genuinely coherent movement can still pass stricter rules.
            if luma < 20 and ref_luma >= 45:
                dark_entry_guard_until=max(dark_entry_guard_until,now+45.0)
            dark_temporal_streak=0
            bg=g.astype(np.float32)
            prev=g.copy()
            candidate_streak=0
            transition_until=now+TRANSITION_MAX_SECONDS
            transition_stable_streak=0
            candidate=False
            source="lighting-transition"
'''
if old_abrupt not in s:
    raise SystemExit("V9 abrupt anchor missing")
s=s.replace(old_abrupt,new_abrupt,1)

old_confirm='''        # V8 fast dark-room path: a clearly coherent dark-scene movement may
        # trigger from a single 4 Hz sample. This specifically catches a person
        # walking briskly past the laptop. Lighting transitions are already
        # quarantined above, so they cannot take this shortcut.
        strong_dark_motion=bool(
            th["mode"]=="dark"
            and not abrupt
            and now>=transition_until
            and temporal_changed>=0.35
            and temporal_largest>=15.0
            and temporal_changed<35.0)
        confirmed=bool((candidate and candidate_streak>=th["confirm"]) or strong_dark_motion)
        if strong_dark_motion:
            last_motion_at=now
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS:
            armed=True
'''
new_confirm='''        # V9: darkness is where V8 was too permissive. Background/exposure
        # drift is often spread across thousands of pixels but fragmented into
        # tiny components. Require a temporally coherent moving component across
        # consecutive 4 Hz samples instead of allowing a one-frame shortcut.
        dark_temporal_ok=bool(
            th["mode"]=="dark"
            and not abrupt
            and now>=transition_until
            and temporal_changed>=0.12
            and temporal_changed<45.0
            and temporal_largest>=12.0
            and temporal_coherence>=0.10)
        if th["mode"]=="dark":
            dark_temporal_streak=(dark_temporal_streak+1) if dark_temporal_ok else 0
        else:
            dark_temporal_streak=0

        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        guarded_dark_ok=bool(
            dark_temporal_ok
            and temporal_changed>=0.35
            and temporal_largest>=80.0
            and temporal_coherence>=0.15)
        if th["mode"]=="dark":
            dark_confirmed=bool(
                (guarded_dark_ok and dark_temporal_streak>=3)
                if in_dark_entry_guard
                else (dark_temporal_ok and dark_temporal_streak>=2))
            confirmed=dark_confirmed
        else:
            dark_confirmed=False
            confirmed=bool(candidate and candidate_streak>=th["confirm"])

        strong_dark_motion=False
        if confirmed:
            last_motion_at=now
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS:
            armed=True
'''
if old_confirm not in s:
    raise SystemExit("V9 confirm anchor missing")
s=s.replace(old_confirm,new_confirm,1)

old_tel='''            "candidate":candidate,
            "strong_dark_motion":strong_dark_motion,
            "confirmed_motion":confirmed,"candidate_streak":candidate_streak,
'''
new_tel='''            "candidate":candidate,
            "strong_dark_motion":strong_dark_motion,
            "dark_temporal_ok":dark_temporal_ok,
            "dark_temporal_streak":dark_temporal_streak,
            "dark_confirmed":dark_confirmed,
            "dark_entry_guard":in_dark_entry_guard,
            "dark_entry_guard_remaining_seconds":round(max(0.0,dark_entry_guard_until-now),1),
            "confirmed_motion":confirmed,"candidate_streak":candidate_streak,
'''
if old_tel not in s:
    raise SystemExit("V9 telemetry anchor missing")
s=s.replace(old_tel,new_tel,1)

# Log the exact coherence/streak used for a future false-positive audit.
old_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f}")
'''
new_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} dark_streak={dark_temporal_streak} dark_guard={in_dark_entry_guard}")
'''
if old_log not in s:
    raise SystemExit("V9 log anchor missing")
s=s.replace(old_log,new_log,1)

SCRIPT.write_text(s)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(6)
show=subprocess.run(
    ["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service",
     "-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
    text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-v9","backup":str(BACKUP),"service":show,"state":state},indent=2))
