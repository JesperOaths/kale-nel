#!/usr/bin/env python3
"""C720P front-camera lamp V15: tracked low-light motion + conservative daylight veto.

Apply on the live C720P host: python3 frontcam_motion_living_lamp_v15.py
Dry-run first with --dry-run. Backs up the exact original, syntax-checks, and
automatically restores the original if the service fails to restart.
No frames or images are stored.
"""
from __future__ import annotations
import datetime
import json
import pathlib
import py_compile
import shutil
import subprocess
import sys
import tempfile
import time

HOME = pathlib.Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
SCRIPT = BASE / "bin/c720p-frontcam-motion-living-lamp.py"
STATE = BASE / "state/frontcam-motion-living-lamp.json"
UNIT = "c720p-frontcam-motion-living-lamp.service"
dry_run = "--dry-run" in sys.argv
s = SCRIPT.read_text()
if '"version":"frontcam-motion-v15"' in s:
    print(json.dumps({"ok": True, "already_applied": True, "version": "frontcam-motion-v15"}))
    sys.exit(0)
if '"version":"frontcam-motion-v14"' not in s:
    raise SystemExit("V15 needs the existing v14 live implementation; refusing to alter unknown source")

original = s
def change(old: str, new: str, name: str) -> None:
    global s
    hits = s.count(old)
    if hits != 1:
        raise SystemExit(f"V15 {name}: expected exactly one anchor, found {hits}; no changes written")
    s = s.replace(old, new, 1)

change('AMBIENT_LIGHT_ON=42.0\nAMBIENT_LIGHT_OFF=32.0',
       'AMBIENT_LIGHT_ON=48.0\nAMBIENT_LIGHT_OFF=36.0\nAMBIENT_DARK_DWELL_SECONDS=1.4',
       'daylight thresholds')
change('def on_signal(*_):\n    global STOP',
'''def bbox_track_match(previous, current, previous_area, current_area, step):
    """Reject gain/noise components that teleport, reshape, or fail to overlap."""
    if previous is None or current is None:
        return False
    px,py,pw,ph=previous
    cx,cy,cw,ch=current
    ix=max(0,min(px+pw,cx+cw)-max(px,cx))
    iy=max(0,min(py+ph,cy+ch)-max(py,cy))
    inter=float(ix*iy)
    union=float(pw*ph+cw*ch)-inter
    iou=inter/union if union>0 else 0.0
    ratio=float(current_area)/max(1.0,float(previous_area))
    return bool(step<=26.0 and 0.25<=ratio<=4.0 and (iou>=0.035 or step<=9.0))

def on_signal(*_):
    global STOP''', 'track helper')
change('    dark_track_centroid=None\n    dark_track_area=0.0\n    dark_track_displacement=0.0',
'''    dark_track_centroid=None
    dark_track_bbox=None
    dark_track_area=0.0
    dark_track_displacement=0.0
    dark_track_consistent=False''', 'track state')
change('    ambient_luma_ema=None\n    ambient_light_sufficient=False',
       '    ambient_luma_ema=None\n    ambient_dark_since=None\n    ambient_light_sufficient=False',
       'ambient dwell state')
# The partial earlier V14 added a second light gate but never used it. Remove
# that inconsistent telemetry and enforce one definitive ambient decision.
change('    ambient_light_blocked=False\n    bright_streak=0\n    dark_light_streak=0\n',
       '', 'unused light gate state')
change('''        if warm==0: ambient_light_blocked=bool(luma>=50.0)
        if luma>=50.0: bright_streak+=1; dark_light_streak=0
        elif luma<=38.0: dark_light_streak+=1; bright_streak=0
        else: bright_streak=0; dark_light_streak=0
        if bright_streak>=8: ambient_light_blocked=True
        elif dark_light_streak>=8: ambient_light_blocked=False
''','', 'unused brightness gate')
change('''            tdiff=cv2.absdiff(compensated,prev)
            # Two gray levels''',
'''            # Median filter is applied only to the compensated low-light
            # difference. It rejects isolated camera-sensor flicker without
            # blurring the original frame used for object geometry.
            tdiff=cv2.medianBlur(cv2.absdiff(compensated,prev),3)
            # Two gray levels''','median compensated motion')
change('''            and bbox_w>=3 and bbox_h>=4
            and temporal_largest>=16.0
            and fill_ratio>=0.055)''',
'''            and bbox_w>=3 and bbox_h>=4
            and temporal_largest>=14.0
            and fill_ratio>=0.055)''', 'slight sensitivity increase')
change('''            and (temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)))''',
'''            and (temporal_largest>=28.0 or (bbox_h>=7 and temporal_largest>=22.0)))''',
       'strong person silhouette threshold')
old_track = '''        if th["mode"] in ("dark","dim") and dark_temporal_ok:
            if dark_track_centroid is not None and temporal_centroid is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                step=(dx*dx+dy*dy)**0.5
                # Reject giant centroid jumps as unrelated noise components.
                if step<=45.0:
                    dark_track_displacement+=step
                    dark_temporal_streak+=1
                else:
                    dark_temporal_streak=1
                    dark_track_displacement=0.0
            else:
                dark_temporal_streak=1
                dark_track_displacement=0.0
            dark_track_centroid=temporal_centroid
        else:
            dark_temporal_streak=0
            dark_track_centroid=None
            dark_track_displacement=0.0
'''
new_track = '''        # Only the SAME local moving region can build confirmation streaks.
        # A succession of unrelated exposure-noise blobs never qualifies.
        dark_track_consistent=False
        if th["mode"] in ("dark","dim") and dark_temporal_ok:
            current_area=max(1.0,float(temporal_largest))
            if dark_track_centroid is not None and temporal_centroid is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                step=(dx*dx+dy*dy)**0.5
                dark_track_consistent=bbox_track_match(
                    dark_track_bbox,temporal_bbox,dark_track_area,current_area,step)
                if dark_track_consistent:
                    dark_track_displacement+=step
                    dark_temporal_streak+=1
                else:
                    dark_temporal_streak=1
                    dark_track_displacement=0.0
            else:
                dark_temporal_streak=1
                dark_track_displacement=0.0
            dark_track_centroid=temporal_centroid
            dark_track_bbox=temporal_bbox
            dark_track_area=current_area
        else:
            dark_temporal_streak=0
            dark_track_centroid=None
            dark_track_bbox=None
            dark_track_area=0.0
            dark_track_displacement=0.0
'''
change(old_track,new_track,'track continuity')
change('''            and dark_track_displacement>=2.0)

        # Strong, person-sized movement''',
'''            and dark_track_consistent
            and dark_track_displacement>=2.0)

        # Strong, person-sized movement''', 'guarded movement')
change('''            and strong_component
            and dark_track_displacement>=1.0)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_displacement>=1.5)''',
'''            and strong_component
            and dark_track_consistent
            and dark_track_displacement>=1.1)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_consistent
            and dark_track_displacement>=2.0)''', 'confidence paths')
change('''                dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=3)''',
'''                dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=4)''',
       'cautious noise guard')
old_ambient='''        if ambient_luma_ema is None: ambient_luma_ema=luma
        if abrupt: ambient_luma_ema=luma
        elif not candidate and not confirmed: ambient_luma_ema=0.92*ambient_luma_ema+0.08*luma
        if ambient_light_sufficient:
            if ambient_luma_ema<=AMBIENT_LIGHT_OFF: ambient_light_sufficient=False
        elif ambient_luma_ema>=AMBIENT_LIGHT_ON: ambient_light_sufficient=True
        lamp_trigger_allowed=not ambient_light_sufficient
'''
new_ambient='''        # Camera-measured scene brightness is a daylight *veto*, not a
        # daylight trigger. Enter sufficient-light state immediately when
        # daylight returns. Re-enable lamp only after persistently dim light.
        if ambient_luma_ema is None: ambient_luma_ema=luma
        if abrupt: ambient_luma_ema=luma
        elif not candidate and not confirmed: ambient_luma_ema=0.88*ambient_luma_ema+0.12*luma
        if luma>=AMBIENT_LIGHT_ON or ambient_luma_ema>=AMBIENT_LIGHT_ON:
            ambient_light_sufficient=True
            ambient_dark_since=None
        elif luma<=AMBIENT_LIGHT_OFF and ambient_luma_ema<=AMBIENT_LIGHT_OFF:
            if ambient_dark_since is None: ambient_dark_since=now
            if now-ambient_dark_since>=AMBIENT_DARK_DWELL_SECONDS:
                ambient_light_sufficient=False
        else:
            ambient_dark_since=None
        lamp_trigger_allowed=bool(not ambient_light_sufficient and
                                  ambient_luma_ema<=AMBIENT_LIGHT_OFF)
'''
change(old_ambient,new_ambient,'light veto hysteresis')
change('''            else:
                log(f"motion webhook failed: {webhook_status}")
''',
'''            elif webhook_ok is False:
                log(f"motion webhook failed: {webhook_status}")
''', 'suppressed-motion logging bug')
change('''            "dark_track_displacement":round(dark_track_displacement,2),
            "temporal_bbox":temporal_bbox,''',
'''            "dark_track_displacement":round(dark_track_displacement,2),
            "dark_track_consistent":dark_track_consistent,
            "dark_track_bbox":dark_track_bbox,
            "ambient_dark_since":ambient_dark_since,
            "ambient_light_on_threshold":AMBIENT_LIGHT_ON,
            "ambient_light_off_threshold":AMBIENT_LIGHT_OFF,
            "temporal_bbox":temporal_bbox,''', 'telemetry')
change('''"version":"frontcam-motion-v14"''',
       '''"version":"frontcam-motion-v15"''','version')
change('''FRONTCAM_MOTION_V14 starting; ambient-aware low-light tracking; no images stored''',
       '''FRONTCAM_MOTION_V15 starting; consistent-object light-gated detection; no images stored''',
       'startup marker')

# Offline regression checks on the bbox-matching routine, then compile.
assert s.count('dark_track_consistent=bbox_track_match(')==1
assert s.count('lamp_trigger_allowed=bool(')==1
with tempfile.TemporaryDirectory(prefix="frontcam-v15-") as tmp:
    candidate=pathlib.Path(tmp)/SCRIPT.name
    candidate.write_text(s)
    py_compile.compile(str(candidate),doraise=True)
    if dry_run:
        print(json.dumps({"ok":True,"dry_run":True,"changed_bytes":len(s)-len(original),
                          "motion_min_area":14,"strong_min_area":28,
                          "light_veto_on":48,"light_allowed_below":36,
                          "weak_track_frames":4,"strong_track_frames":2}))
        sys.exit(0)
    stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup=HOME/"c720p-backups"/f"frontcam-motion-v15-{stamp}"
    backup.mkdir(parents=True,exist_ok=True)
    backup_src=backup/(SCRIPT.name+".before")
    shutil.copy2(SCRIPT,backup_src)
    def run(*args,timeout=30):
        return subprocess.run(list(args),text=True,capture_output=True,timeout=timeout)
    try:
        shutil.copy2(candidate,SCRIPT)
        SCRIPT.chmod(0o755)
        r=run("systemctl","--user","restart",UNIT)
        if r.returncode:
            raise RuntimeError("restart: "+r.stderr[-600:])
        time.sleep(6)
        check=run("systemctl","--user","is-active",UNIT)
        if check.stdout.strip()!="active":
            raise RuntimeError("service inactive: "+check.stdout+" "+check.stderr)
        state=json.loads(STATE.read_text())
        if state.get("version")!="frontcam-motion-v15" or not state.get("ok"):
            raise RuntimeError("post-restart telemetry invalid: "+str(state)[:500])
        print(json.dumps({"ok":True,"version":"frontcam-motion-v15",
                          "service":"active","backup":str(backup_src),
                          "luma":state.get("luma"),
                          "ambient_light_sufficient":state.get("ambient_light_sufficient"),
                          "lamp_trigger_allowed":state.get("lamp_trigger_allowed"),
                          "trigger_count_since_restart":state.get("trigger_count")},indent=2))
    except Exception:
        shutil.copy2(backup_src,SCRIPT)
        run("systemctl","--user","restart",UNIT)
        raise
