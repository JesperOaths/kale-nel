#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v10-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('FRONTCAM_MOTION_V9 starting; stricter coherent dark-motion confirmation; no images stored',
            'FRONTCAM_MOTION_V10 starting; tracked coherent dark-motion confirmation; no images stored')
s=s.replace('"version":"frontcam-motion-v9"','"version":"frontcam-motion-v10"')
s=s.replace('FRONTCAM_MOTION_V9 stopped','FRONTCAM_MOTION_V10 stopped')

old_metrics='''def metrics(mask):
    changed=float(cv2.countNonZero(mask))*100.0/float(WIDTH*HEIGHT)
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    largest=max((float(cv2.contourArea(c)) for c in contours),default=0.0)
    return changed,largest
'''
new_metrics='''def metrics(mask):
    changed=float(cv2.countNonZero(mask))*100.0/float(WIDTH*HEIGHT)
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return changed,0.0,None,None
    c=max(contours,key=cv2.contourArea)
    largest=float(cv2.contourArea(c))
    x,y,w,h=cv2.boundingRect(c)
    centroid=(float(x+w/2.0),float(y+h/2.0))
    bbox=(int(x),int(y),int(w),int(h))
    return changed,largest,centroid,bbox
'''
if old_metrics not in s: raise SystemExit("V10 metrics anchor missing")
s=s.replace(old_metrics,new_metrics,1)

s=s.replace('''        bg_changed,bg_largest=metrics(bgmask)
''','''        bg_changed,bg_largest,bg_centroid,bg_bbox=metrics(bgmask)
''',1)
s=s.replace('''        temporal_changed,temporal_largest=metrics(tmask)
''','''        # Suppress isolated dark-sensor speckle while keeping contiguous
        # person-sized silhouettes. This is cheap 2x2 morphology, not AI.
        if th["mode"]=="dark":
            tmask=cv2.morphologyEx(tmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        temporal_changed,temporal_largest,temporal_centroid,temporal_bbox=metrics(tmask)
''',1)

old_init='''    dark_entry_guard_until=0.0
    dark_temporal_streak=0
    latest={}
'''
new_init='''    dark_entry_guard_until=0.0
    dark_temporal_streak=0
    dark_track_centroid=None
    dark_track_displacement=0.0
    latest={}
'''
if old_init not in s: raise SystemExit("V10 init anchor missing")
s=s.replace(old_init,new_init,1)

old_dark='''        dark_temporal_ok=bool(
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
'''
new_dark='''        # V10 adds actual movement tracking. Exposure noise can change many
        # pixels while remaining spatially stationary or fragmented. A person
        # walking past the laptop produces a contiguous component whose centroid
        # moves over consecutive samples.
        bbox_w=(temporal_bbox[2] if temporal_bbox else 0)
        bbox_h=(temporal_bbox[3] if temporal_bbox else 0)
        bbox_pixels=float(bbox_w*bbox_h) if temporal_bbox else 0.0
        fill_ratio=(float(temporal_largest)/bbox_pixels) if bbox_pixels>0 else 0.0
        humanish_component=bool(
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

        in_dark_entry_guard=bool(now<dark_entry_guard_until)
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
        else:
            dark_confirmed=False
            confirmed=bool(candidate and candidate_streak>=th["confirm"])
'''
if old_dark not in s: raise SystemExit("V10 dark anchor missing")
s=s.replace(old_dark,new_dark,1)

old_tel='''            "dark_temporal_ok":dark_temporal_ok,
            "dark_temporal_streak":dark_temporal_streak,
            "dark_confirmed":dark_confirmed,
'''
new_tel='''            "dark_temporal_ok":dark_temporal_ok,
            "dark_temporal_streak":dark_temporal_streak,
            "dark_track_displacement":round(dark_track_displacement,2),
            "temporal_bbox":temporal_bbox,
            "temporal_centroid":temporal_centroid,
            "temporal_fill_ratio":round(fill_ratio,3),
            "humanish_component":humanish_component,
            "dark_confirmed":dark_confirmed,
'''
if old_tel not in s: raise SystemExit("V10 telemetry anchor missing")
s=s.replace(old_tel,new_tel,1)

old_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} dark_streak={dark_temporal_streak} dark_guard={in_dark_entry_guard}")
'''
new_log='''                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f} coherence={temporal_coherence:.3f} bbox={temporal_bbox} fill={fill_ratio:.3f} displacement={dark_track_displacement:.2f} dark_streak={dark_temporal_streak} dark_guard={in_dark_entry_guard}")
'''
if old_log not in s: raise SystemExit("V10 log anchor missing")
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
print(json.dumps({"ok":True,"version":"frontcam-motion-v10","backup":str(BACKUP),"service":show,"state":state},indent=2))
