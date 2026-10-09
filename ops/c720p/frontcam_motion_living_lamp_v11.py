#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v11-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V10 starting; tracked coherent dark-motion confirmation; no images stored',
            'FRONTCAM_MOTION_V11 starting; forgiving tracked dark-motion confirmation; no images stored')
s=s.replace('"version":"frontcam-motion-v10"','"version":"frontcam-motion-v11"')
s=s.replace('FRONTCAM_MOTION_V10 stopped','FRONTCAM_MOTION_V11 stopped')

old='''        humanish_component=bool(
            temporal_bbox
            and bbox_w>=4 and bbox_h>=6
            and temporal_largest>=24.0
            and fill_ratio>=0.08)

        dark_temporal_ok=bool(
            th["mode"]=="dark"
            and not abrupt
            and now>=transition_until
            and temporal_changed>=0.10
            and temporal_changed<42.0
            and temporal_coherence>=0.10
            and humanish_component)

        if th["mode"]=="dark" and dark_temporal_ok:
'''
new='''        humanish_component=bool(
            temporal_bbox
            and bbox_w>=3 and bbox_h>=5
            and temporal_largest>=18.0
            and fill_ratio>=0.07)

        # V11 deliberately eases only the moving-object path. It keeps V10's
        # spatial tracking, so scattered sensor noise still cannot trigger.
        # Crucially, real localized movement is no longer completely blocked
        # while the webcam is still settling after a large exposure change.
        in_transition_guard=bool(now<transition_until)
        dark_temporal_ok=bool(
            th["mode"]=="dark"
            and not abrupt
            and temporal_changed>=0.08
            and temporal_changed<42.0
            and temporal_coherence>=0.08
            and humanish_component)

        if th["mode"]=="dark" and dark_temporal_ok:
'''
if old not in s:
    raise SystemExit("V11 dark base anchor missing")
s=s.replace(old,new,1)

old2='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        guarded_dark_ok=bool(
            dark_temporal_ok
            and temporal_changed>=0.30
            and temporal_largest>=100.0
            and temporal_coherence>=0.15
            and dark_track_displacement>=3.0)
        ordinary_dark_ok=bool(
            dark_temporal_ok
            and dark_track_displacement>=2.0)

        if th["mode"]=="dark":
            dark_confirmed=bool(
                (guarded_dark_ok and dark_temporal_streak>=3)
                if in_dark_entry_guard
                else (ordinary_dark_ok and dark_temporal_streak>=3))
            confirmed=dark_confirmed
'''
new2='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        strict_dark_guard=bool(in_dark_entry_guard or in_transition_guard)
        guarded_dark_ok=bool(
            dark_temporal_ok
            and temporal_changed>=0.28
            and temporal_largest>=80.0
            and temporal_coherence>=0.12
            and fill_ratio>=0.09
            and dark_track_displacement>=2.5)
        ordinary_dark_ok=bool(
            dark_temporal_ok
            and dark_track_displacement>=1.5)

        if th["mode"]=="dark":
            dark_confirmed=bool(
                (guarded_dark_ok and dark_temporal_streak>=3)
                if strict_dark_guard
                else (ordinary_dark_ok and dark_temporal_streak>=2))
            confirmed=dark_confirmed
'''
if old2 not in s:
    raise SystemExit("V11 confirm anchor missing")
s=s.replace(old2,new2,1)

old3='''            "dark_entry_guard":in_dark_entry_guard,
            "dark_entry_guard_remaining_seconds":round(max(0.0,dark_entry_guard_until-now),1),
'''
new3='''            "dark_entry_guard":in_dark_entry_guard,
            "transition_motion_guard":in_transition_guard,
            "strict_dark_guard":strict_dark_guard,
            "dark_entry_guard_remaining_seconds":round(max(0.0,dark_entry_guard_until-now),1),
'''
if old3 not in s:
    raise SystemExit("V11 telemetry anchor missing")
s=s.replace(old3,new3,1)

old4='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={in_dark_entry_guard}")
'''
new4='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={strict_dark_guard}")
'''
if old4 not in s:
    raise SystemExit("V11 log anchor missing")
s=s.replace(old4,new4,1)

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
print(json.dumps({"ok":True,"version":"frontcam-motion-v11","backup":str(BACKUP),"service":show,"state":state},indent=2))
