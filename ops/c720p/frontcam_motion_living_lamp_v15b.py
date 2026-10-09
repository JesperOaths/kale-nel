#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, subprocess, time, json, py_compile

p=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
b=Path("/home/jespern/c720p-backups")/("frontcam-v15b-"+datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
b.mkdir(parents=True,exist_ok=True); shutil.copy2(p,b/(p.name+".before"))
s=p.read_text()

if "FRONTCAM_MOTION_V14" not in s:
    raise SystemExit("expected V14 live source")

s=s.replace("FRONTCAM_MOTION_V14 starting; ambient-aware low-light tracking; no images stored",
            "FRONTCAM_MOTION_V15 starting; ambient-gated stable low-light tracking; no images stored")
s=s.replace('"frontcam-motion-v14"','"frontcam-motion-v15"').replace("FRONTCAM_MOTION_V14 stopped","FRONTCAM_MOTION_V15 stopped")

s=s.replace(
'''    dark_track_centroid=None
    dark_track_area=0.0
    dark_track_displacement=0.0
    flicker_reject_count=0
''',
'''    dark_track_centroid=None
    dark_track_area=0.0
    dark_track_last_step=None
    dark_track_displacement=0.0
    dark_track_consistent=False
    flicker_reject_count=0
''',1)

s=s.replace("and temporal_largest<45.0)","and temporal_largest<60.0)",1)

s=s.replace(
'''        strong_component=bool(
            humanish_component
            and (temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)))
''',
'''        strong_component=bool(
            humanish_component
            and (temporal_largest>=28.0 or (bbox_h>=7 and temporal_largest>=22.0)))
''',1)

old='''        if th["mode"] in ("dark","dim") and dark_temporal_ok:
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
new='''        if th["mode"] in ("dark","dim") and dark_temporal_ok:
            current_area=max(1.0,float(temporal_largest))
            if dark_track_centroid is not None and temporal_centroid is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                step=(dx*dx+dy*dy)**0.5
                area_ratio=current_area/max(1.0,dark_track_area)
                direction_ok=True
                if dark_track_last_step is not None and step>0.001:
                    pdx,pdy=dark_track_last_step
                    plen=max(0.001,(pdx*pdx+pdy*pdy)**0.5)
                    cosine=(dx*pdx+dy*pdy)/(plen*step)
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
if old not in s: raise SystemExit("track anchor missing")
s=s.replace(old,new,1)

old='''        fast_dark_ok=bool(
            dark_temporal_ok
            and strong_component
            and dark_track_displacement>=1.0)
        cautious_dark_ok=bool(
            dark_temporal_ok
            and not strong_component
            and dark_track_displacement>=1.5)
'''
new='''        fast_dark_ok=bool(
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
if old not in s: raise SystemExit("confirm anchor missing")
s=s.replace(old,new,1)

# Use both light gates already present in V14. The fast streak gate reacts to
# real daylight quickly; the EMA gate supplies hysteresis against clouds.
s=s.replace(
"        lamp_trigger_allowed=not ambient_light_sufficient",
"        lamp_trigger_allowed=not (ambient_light_sufficient or ambient_light_blocked)",1)

s=s.replace(
'''            "dark_track_displacement":round(dark_track_displacement,2),
            "temporal_bbox":temporal_bbox,
''',
'''            "dark_track_displacement":round(dark_track_displacement,2),
            "dark_track_consistent":dark_track_consistent,
            "dark_track_area":round(dark_track_area,1),
            "temporal_bbox":temporal_bbox,
''',1)

# Ambient-suppressed motion is expected; don't label it as a webhook failure.
s=s.replace(
'''            else:
                log(f"motion webhook failed: {webhook_status}")

        latest={
''',
'''            elif webhook_status is not None:
                log(f"motion webhook failed: {webhook_status}")

        latest={
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
