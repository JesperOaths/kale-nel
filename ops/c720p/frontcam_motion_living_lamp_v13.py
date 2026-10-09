#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v13-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V12 starting; exposure-compensated tracked dark motion; no images stored',
            'FRONTCAM_MOTION_V13 starting; adaptive-confidence dark motion; no images stored')
s=s.replace('"version":"frontcam-motion-v12"','"version":"frontcam-motion-v13"')
s=s.replace('FRONTCAM_MOTION_V12 stopped','FRONTCAM_MOTION_V13 stopped')

old_logic='''        # With exposure pumping removed we can be slightly more sensitive to
        # a real small/fast silhouette than V11, while rejecting the exact false
        # pattern seen in V11: 30-40% of the frame changing with low coherence.
        humanish_component=bool(
            temporal_bbox
            and bbox_w>=3 and bbox_h>=4
            and temporal_largest>=14.0
            and fill_ratio>=0.055)

        global_flicker_like=bool(
            th["mode"]=="dark"
            and temporal_changed>=16.0
            and temporal_coherence<0.20)

        in_transition_guard=bool(now<transition_until)
        dark_temporal_ok=bool(
            th["mode"]=="dark"
            and not abrupt
            and not global_flicker_like
            and temporal_changed>=0.055
            and temporal_changed<45.0
            and temporal_coherence>=0.06
            and humanish_component)
        if global_flicker_like:
            flicker_reject_count+=1

        if th["mode"]=="dark" and dark_temporal_ok:
'''
new_logic='''        # V13 uses two evidence tiers. A normal person-sized component can
        # trigger quickly; a very small component is allowed to remain a
        # candidate but must persist longer. This keeps sensitivity without
        # treating a 4-pixel-high dark-noise blob as a person.
        humanish_component=bool(
            temporal_bbox
            and bbox_w>=3 and bbox_h>=5
            and temporal_largest>=18.0
            and fill_ratio>=0.065)

        # The V12 false trigger had ~36% raw frame churn, but after exposure
        # compensation only 0.76% remained and its largest blob was 14 pixels.
        # That is a characteristic webcam gain/noise event, not useful motion.
        exposure_noise_like=bool(
            th["mode"]=="dark"
            and raw_temporal_changed>=20.0
            and temporal_changed<=2.0
            and temporal_largest<45.0)

        broad_flicker_like=bool(
            th["mode"]=="dark"
            and temporal_changed>=16.0
            and temporal_coherence<0.20)
        global_flicker_like=bool(exposure_noise_like or broad_flicker_like)

        strong_component=bool(
            humanish_component
            and (temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)))

        in_transition_guard=bool(now<transition_until)
        dark_temporal_ok=bool(
            th["mode"]=="dark"
            and not abrupt
            and not global_flicker_like
            and temporal_changed>=0.05
            and temporal_changed<45.0
            and temporal_coherence>=0.06
            and humanish_component)
        if global_flicker_like:
            flicker_reject_count+=1

        if th["mode"]=="dark" and dark_temporal_ok:
'''
if old_logic not in s:
    raise SystemExit("V13 candidate anchor missing")
s=s.replace(old_logic,new_logic,1)

old_guard='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        strict_dark_guard=bool(in_dark_entry_guard or in_transition_guard)
        guarded_dark_ok=bool(
            dark_temporal_ok
            and temporal_changed>=0.20
            and temporal_largest>=60.0
            and temporal_coherence>=0.10
            and fill_ratio>=0.075
            and dark_track_displacement>=2.0)
        ordinary_dark_ok=bool(
            dark_temporal_ok
            and dark_track_displacement>=1.0)

        if th["mode"]=="dark":
            dark_confirmed=bool(
                (guarded_dark_ok and dark_temporal_streak>=3)
                if strict_dark_guard
                else (ordinary_dark_ok and dark_temporal_streak>=2))
            confirmed=dark_confirmed
'''
new_guard='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        strict_dark_guard=bool(in_dark_entry_guard or in_transition_guard)
        guarded_dark_ok=bool(
            dark_temporal_ok
            and temporal_changed>=0.18
            and temporal_largest>=55.0
            and temporal_coherence>=0.10
            and fill_ratio>=0.075
            and dark_track_displacement>=2.0)

        # Strong, person-sized movement gets the fast two-sample path.
        # Marginal/small movement is more sensitive than V10 in raw threshold,
        # but must survive three tracked samples before it can switch the lamp.
        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_displacement>=1.0)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_displacement>=1.5)

        if th["mode"]=="dark":
            if strict_dark_guard:
                dark_confirmed=bool(guarded_dark_ok and dark_temporal_streak>=3)
            elif fast_dark_ok:
                dark_confirmed=bool(dark_temporal_streak>=2)
            else:
                dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=3)
            confirmed=dark_confirmed
'''
if old_guard not in s:
    raise SystemExit("V13 guard anchor missing")
s=s.replace(old_guard,new_guard,1)

old_tel='''            "humanish_component":humanish_component,
            "global_flicker_like":global_flicker_like,
            "flicker_reject_count":flicker_reject_count,
'''
new_tel='''            "humanish_component":humanish_component,
            "strong_component":strong_component,
            "exposure_noise_like":exposure_noise_like,
            "broad_flicker_like":broad_flicker_like,
            "global_flicker_like":global_flicker_like,
            "flicker_reject_count":flicker_reject_count,
'''
if old_tel not in s:
    raise SystemExit("V13 telemetry anchor missing")
s=s.replace(old_tel,new_tel,1)

old_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={strict_dark_guard}")
'''
new_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} strong={strong_component} dark_guard={strict_dark_guard}")
'''
if old_log not in s:
    raise SystemExit("V13 log anchor missing")
s=s.replace(old_log,new_log,1)

SCRIPT.write_text(s)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(8)
show=subprocess.run(
    ["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service",
     "-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
    text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-v13","backup":str(BACKUP),"service":show,"state":state},indent=2))
