#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess, time, json, py_compile

p=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
b=Path("/home/jespern/c720p-backups")/("frontcam-v15-trackfix-"+datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
b.mkdir(parents=True,exist_ok=True); shutil.copy2(p,b/(p.name+".before"))
s=p.read_text()

s=s.replace("FRONTCAM_MOTION_V14 starting; ambient-aware low-light tracking; no images stored",
            "FRONTCAM_MOTION_V15 starting; ambient-gated stable low-light tracking; no images stored")
s=s.replace('"frontcam-motion-v14"','"frontcam-motion-v15"').replace("FRONTCAM_MOTION_V14 stopped","FRONTCAM_MOTION_V15 stopped")

old='''    dark_track_centroid=None
    dark_track_displacement=0.0
    flicker_reject_count=0
    ambient_luma_ema=None
'''
new='''    dark_track_centroid=None
    dark_track_area=0.0
    dark_track_last_step=None
    dark_track_displacement=0.0
    dark_track_consistent=False
    flicker_reject_count=0
    ambient_luma_ema=None
'''
if old not in s: raise SystemExit("init anchor missing")
s=s.replace(old,new,1)

# Treat more residuals as exposure noise. This specifically covers the observed
# false-positive family: lots of raw webcam churn, tiny post-compensation blob.
s=s.replace("and temporal_largest<45.0)","and temporal_largest<60.0)",1)

# Make a real person a little easier to classify as strong.
s=s.replace(
'''        strong_component=bool(
            humanish_component
            and (temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)))
''',
'''        strong_component=bool(
            humanish_component
            and (temporal_largest>=28.0 or (bbox_h>=7 and temporal_largest>=22.0)))
''',1)

oldtrack='''        if th["mode"] in ("dark","dim") and dark_temporal_ok:
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
newtrack='''        if th["mode"] in ("dark","dim") and dark_temporal_ok:
            current_area=max(1.0,float(temporal_largest))
            if dark_track_centroid is not None and temporal_centroid is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                step=(dx*dx+dy*dy)**0.5
                area_ratio=current_area/max(1.0,dark_track_area)
                direction_ok=True
                if dark_track_last_step is not None:
                    pdx,pdy=dark_track_last_step
                    plen=max(0.001,(pdx*pdx+pdy*pdy)**0.5)
                    slen=max(0.001,step)
                    cosine=(dx*pdx+dy*pdy)/(plen*slen)
                    direction_ok=bool(cosine>=-0.20)
                dark_track_consistent=bool(
                    0.20<=step<=30.0
                    and 0.32<=area_ratio<=3.10
                    and direction_ok)
                if dark_track_consistent:
                    dark_track_displacement+=step
                    dark_temporal_streak+=1
                else:
                    dark_temporal_streak=1
                    dark_track_displacement=0.0
                dark_track_last_step=(dx,dy)
            else:
                dark_track_consistent=False
                dark_temporal_streak=1
                dark_track_displacement=0.0
                dark_track_last_step=None
            dark_track_centroid=temporal_centroid
            dark_track_area=current_area
        else:
            dark_temporal_streak=0
            dark_track_centroid=None
            dark_track_area=0.0
            dark_track_last_step=None
            dark_track_displacement=0.0
            dark_track_consistent=False
'''
if oldtrack not in s: raise SystemExit("track anchor missing")
s=s.replace(oldtrack,newtrack,1)

oldok='''        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_displacement>=1.0)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_displacement>=1.5)
'''
newok='''        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_consistent
            and dark_track_displacement>=0.8)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_consistent
            and dark_track_displacement>=1.4)
'''
if oldok not in s: raise SystemExit("confirm anchor missing")
s=s.replace(oldok,newok,1)

# Add track quality to telemetry.
s=s.replace(
'''            "dark_track_displacement":round(dark_track_displacement,2),
            "temporal_bbox":temporal_bbox,
''',
'''            "dark_track_displacement":round(dark_track_displacement,2),
            "dark_track_consistent":dark_track_consistent,
            "dark_track_area":round(dark_track_area,1),
            "temporal_bbox":temporal_bbox,
''',1)

# Avoid logging an ambient-suppressed event as a webhook failure.
s=s.replace(
'''            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} strong={strong_component} dark_guard={strict_dark_guard}")
            else:
                log(f"motion webhook failed: {webhook_status}")
''',
'''            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} ambient={ambient_luma_ema:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} rawTemporal={raw_temporal_changed:.2f}% exposureShift={exposure_shift:.1f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} stableTrack={dark_track_consistent} dark_streak={dark_temporal_streak} strong={strong_component} dark_guard={strict_dark_guard}")
            elif webhook_status is not None:
                log(f"motion webhook failed: {webhook_status}")
''',1)

p.write_text(s); p.chmod(0o755); py_compile.compile(str(p),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(7)
print(json.dumps({
  "ok":True,
  "version":"frontcam-motion-v15",
  "backup":str(b),
  "state":json.loads((Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json")).read_text())
},indent=2))
