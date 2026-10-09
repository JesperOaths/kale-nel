#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v14-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

# Accept either V13 or an earlier partial V14 as input, but refuse unknown bases.
if "frontcam-motion-v13" not in s and "frontcam-motion-v14" not in s:
    raise SystemExit("Unexpected frontcam base version")
s=s.replace('FRONTCAM_MOTION_V13 starting; adaptive-confidence dark motion; no images stored',
            'FRONTCAM_MOTION_V14 starting; ambient-gated stable-track dark motion; no images stored')
s=s.replace('FRONTCAM_MOTION_V14 starting; ambient-aware low-light tracking; no images stored',
            'FRONTCAM_MOTION_V14 starting; ambient-gated stable-track dark motion; no images stored')
s=s.replace('"version":"frontcam-motion-v13"','"version":"frontcam-motion-v14"')
s=s.replace('FRONTCAM_MOTION_V13 stopped','FRONTCAM_MOTION_V14 stopped')

# Add overlap-aware tracking helper.
anchor='''def on_signal(*_):
    global STOP
'''
if "def bbox_iou(" not in s:
    helper='''def bbox_iou(a,b):
    if not a or not b: return 0.0
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    ax2=ax+aw; ay2=ay+ah; bx2=bx+bw; by2=by+bh
    iw=max(0,min(ax2,bx2)-max(ax,bx))
    ih=max(0,min(ay2,by2)-max(ay,by))
    inter=float(iw*ih)
    union=float(aw*ah+bw*bh)-inter
    return inter/union if union>0 else 0.0

def on_signal(*_):
    global STOP
'''
    if anchor not in s: raise SystemExit("bbox helper anchor missing")
    s=s.replace(anchor,helper,1)

# State additions.
old='''    dark_track_centroid=None
    dark_track_displacement=0.0
    flicker_reject_count=0
    latest={}
'''
new='''    dark_track_centroid=None
    dark_track_bbox=None
    dark_track_area=0.0
    dark_track_displacement=0.0
    dark_track_consistent=False
    flicker_reject_count=0
    bright_motion_suppressed_count=0
    ambient_luma_ema=None
    ambient_dark_since=None
    lamp_light_allowed=False
    latest={}
'''
if old in s:
    s=s.replace(old,new,1)
elif "dark_track_bbox=None" not in s:
    raise SystemExit("state anchor missing")

# Ambient light is measured from the same webcam. Empirical live values:
# genuine dark ~5-15/255; daylight/lamp-lit room ~80-130/255.
old='''        g=preprocess(frame)
        luma=float(np.mean(g))
        frame_std=float(np.std(g))
        now=time.time()
'''
new='''        g=preprocess(frame)
        luma=float(np.mean(g))
        frame_std=float(np.std(g))
        now=time.time()

        # Ambient-light gate with smoothing + hysteresis. If daylight through
        # open curtains is already useful, motion is still measured but it can
        # never switch on the living-room lamp.
        ambient_luma_ema=luma if ambient_luma_ema is None else (0.12*luma+0.88*ambient_luma_ema)
        if ambient_luma_ema <= 32.0:
            if ambient_dark_since is None:
                ambient_dark_since=now
            if now-ambient_dark_since >= 2.0:
                lamp_light_allowed=True
        elif ambient_luma_ema >= 45.0:
            ambient_dark_since=None
            lamp_light_allowed=False
'''
if old in s:
    s=s.replace(old,new,1)
elif "ambient_dark_since" not in s:
    raise SystemExit("ambient anchor missing")

# Stable same-object tracking replaces centroid-only tracking.
old='''        if th["mode"]=="dark" and dark_temporal_ok:
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
new='''        if th["mode"]=="dark" and dark_temporal_ok:
            current_area=max(1.0,float(temporal_largest))
            if dark_track_centroid is not None and temporal_centroid is not None and dark_track_bbox is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                step=(dx*dx+dy*dy)**0.5
                iou=bbox_iou(dark_track_bbox,temporal_bbox)
                area_ratio=current_area/max(1.0,dark_track_area)
                dark_track_consistent=bool(
                    step<=32.0
                    and (iou>=0.025 or step<=14.0)
                    and 0.30<=area_ratio<=3.30)
                if dark_track_consistent:
                    dark_track_displacement+=step
                    dark_temporal_streak+=1
                else:
                    dark_temporal_streak=1
                    dark_track_displacement=0.0
            else:
                dark_track_consistent=False
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
            dark_track_consistent=False
'''
if old in s:
    s=s.replace(old,new,1)
elif "dark_track_consistent=bool(" not in s:
    raise SystemExit("track anchor missing")

# Keep the V13 exposure-noise rejection, but make real silhouettes a little
# easier to qualify. Noise must still pass the stable-track test above.
s=s.replace('''        strong_component=bool(
            humanish_component
            and (temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)))
''','''        strong_component=bool(
            humanish_component
            and (temporal_largest>=28.0 or (bbox_h>=7 and temporal_largest>=22.0)))
''',1)

s=s.replace('''        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_displacement>=1.0)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_displacement>=1.5)
''','''        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_consistent
            and dark_track_displacement>=0.8)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_consistent
            and dark_track_displacement>=1.4)
''',1)

# Ambient gate acts only on the lamp action, never on motion observation.
old='''        webhook_ok=None
        webhook_status=None
        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            webhook_ok,webhook_status=post_motion()
'''
new='''        webhook_ok=None
        webhook_status=None
        lamp_trigger_eligible=bool(confirmed and lamp_light_allowed)
        if confirmed and not lamp_light_allowed:
            bright_motion_suppressed_count+=1
        if lamp_trigger_eligible and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            webhook_ok,webhook_status=post_motion()
'''
if old in s:
    s=s.replace(old,new,1)
elif "lamp_trigger_eligible" not in s:
    raise SystemExit("webhook anchor missing")

# Telemetry for tuning from real events.
old='''            "dark_track_displacement":round(dark_track_displacement,2),
            "temporal_bbox":temporal_bbox,
'''
new='''            "dark_track_displacement":round(dark_track_displacement,2),
            "dark_track_consistent":dark_track_consistent,
            "dark_track_bbox":dark_track_bbox,
            "ambient_luma_ema":round(float(ambient_luma_ema),1) if ambient_luma_ema is not None else None,
            "ambient_dark_since":ambient_dark_since,
            "lamp_light_allowed":lamp_light_allowed,
            "lamp_trigger_eligible":lamp_trigger_eligible,
            "bright_motion_suppressed_count":bright_motion_suppressed_count,
            "temporal_bbox":temporal_bbox,
'''
if old in s:
    s=s.replace(old,new,1)
elif "bright_motion_suppressed_count" not in s:
    raise SystemExit("telemetry anchor missing")

oldlog='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} strong={strong_component} dark_guard={strict_dark_guard}")
'''
newlog='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} ambient={ambient_luma_ema:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} stableTrack={dark_track_consistent} dark_streak={dark_temporal_streak} strong={strong_component} dark_guard={strict_dark_guard}")
'''
if oldlog in s:
    s=s.replace(oldlog,newlog,1)

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
print(json.dumps({"ok":True,"version":"frontcam-motion-v14","backup":str(BACKUP),"service":show,"state":state},indent=2))
