#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v12-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V11 starting; forgiving tracked dark-motion confirmation; no images stored',
            'FRONTCAM_MOTION_V12 starting; exposure-compensated tracked dark motion; no images stored')
s=s.replace('"version":"frontcam-motion-v11"','"version":"frontcam-motion-v12"')
s=s.replace('FRONTCAM_MOTION_V11 stopped','FRONTCAM_MOTION_V12 stopped')

# Replace the raw dark frame-difference with exposure-compensated difference.
# Median photometric shift removes the webcam's global dark-scene gain/exposure
# pumping before we look for a moving object.
old_diff='''        if prev is None:
            prev=g.copy()
        tdiff=cv2.absdiff(g,prev)
        temporal_delta=max(2,th["delta"]-1) if th["mode"]=="dark" else th["delta"]
        tmask=(tdiff>=temporal_delta).astype(np.uint8)*255
        if th["mode"]=="normal":
            tmask=cv2.morphologyEx(tmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        # Suppress isolated dark-sensor speckle while keeping contiguous
        # person-sized silhouettes. This is cheap 2x2 morphology, not AI.
        if th["mode"]=="dark":
            tmask=cv2.morphologyEx(tmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        temporal_changed,temporal_largest,temporal_centroid,temporal_bbox=metrics(tmask)
'''
new_diff='''        if prev is None:
            prev=g.copy()

        # V12 photometric compensation. In darkness this webcam regularly
        # changes gain/exposure across most of the frame even when nothing in
        # the room moves. Estimate that global brightness shift with the median
        # pixel delta, cancel it, then detect only residual/local movement.
        raw_tdiff=cv2.absdiff(g,prev)
        raw_temporal_changed=float(np.mean(raw_tdiff>=max(1,th["delta"]-1)))*100.0
        if th["mode"]=="dark":
            signed=g.astype(np.int16)-prev.astype(np.int16)
            exposure_shift=float(np.median(signed))
            compensated=np.clip(g.astype(np.int16)-int(round(exposure_shift)),0,255).astype(np.uint8)
            tdiff=cv2.absdiff(compensated,prev)
            # Two gray levels is still very sensitive at luma ~5-15, while
            # avoiding the one-level quantisation chatter that caused V11 noise.
            temporal_delta=2
        else:
            exposure_shift=0.0
            tdiff=raw_tdiff
            temporal_delta=th["delta"]

        tmask=(tdiff>=temporal_delta).astype(np.uint8)*255
        if th["mode"] in ("dark","normal"):
            tmask=cv2.morphologyEx(tmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        temporal_changed,temporal_largest,temporal_centroid,temporal_bbox=metrics(tmask)
'''
if old_diff not in s:
    raise SystemExit("V12 temporal-difference anchor missing")
s=s.replace(old_diff,new_diff,1)

old_init='''    dark_track_centroid=None
    dark_track_displacement=0.0
    latest={}
'''
new_init='''    dark_track_centroid=None
    dark_track_displacement=0.0
    flicker_reject_count=0
    latest={}
'''
if old_init not in s:
    raise SystemExit("V12 init anchor missing")
s=s.replace(old_init,new_init,1)

old_logic='''        humanish_component=bool(
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
new_logic='''        # With exposure pumping removed we can be slightly more sensitive to
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
if old_logic not in s:
    raise SystemExit("V12 dark candidate anchor missing")
s=s.replace(old_logic,new_logic,1)

old_guard='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
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
new_guard='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
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
if old_guard not in s:
    raise SystemExit("V12 guard anchor missing")
s=s.replace(old_guard,new_guard,1)

old_tel='''            "temporal_changed_percent":round(temporal_changed,3),
            "temporal_largest_contour_area":round(temporal_largest,1),
'''
new_tel='''            "temporal_changed_percent":round(temporal_changed,3),
            "raw_temporal_changed_percent":round(raw_temporal_changed,3),
            "exposure_shift":round(exposure_shift,2),
            "temporal_largest_contour_area":round(temporal_largest,1),
'''
if old_tel not in s:
    raise SystemExit("V12 telemetry temporal anchor missing")
s=s.replace(old_tel,new_tel,1)

old_tel2='''            "humanish_component":humanish_component,
            "dark_confirmed":dark_confirmed,
'''
new_tel2='''            "humanish_component":humanish_component,
            "global_flicker_like":global_flicker_like,
            "flicker_reject_count":flicker_reject_count,
            "dark_confirmed":dark_confirmed,
'''
if old_tel2 not in s:
    raise SystemExit("V12 telemetry flicker anchor missing")
s=s.replace(old_tel2,new_tel2,1)

old_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={strict_dark_guard}")
'''
new_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={strict_dark_guard}")
'''
if old_log not in s:
    raise SystemExit("V12 log anchor missing")
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
print(json.dumps({"ok":True,"version":"frontcam-motion-v12","backup":str(BACKUP),"service":show,"state":state},indent=2))
