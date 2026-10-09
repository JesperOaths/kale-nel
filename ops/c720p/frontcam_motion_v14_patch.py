from pathlib import Path
import re, subprocess, py_compile, time, json
p=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
s=p.read_text()

s=s.replace("frontcam-motion-v13","frontcam-motion-v14")
s=s.replace("adaptive-confidence dark motion","light-aware continuous low-light tracking")

s=s.replace("    dark_track_centroid=None\n    dark_track_displacement=0.0\n    flicker_reject_count=0\n",
"""    dark_track_centroid=None
    dark_track_area=0.0
    dark_track_displacement=0.0
    flicker_reject_count=0
    ambient_light_blocked=False
    bright_streak=0
    dark_light_streak=0
""",1)

s=s.replace("        now=time.time()\n        if bg is None:\n",
"""        now=time.time()
        if warm==0:
            ambient_light_blocked=bool(luma>=50.0)
        if luma>=50.0:
            bright_streak+=1; dark_light_streak=0
        elif luma<=38.0:
            dark_light_streak+=1; bright_streak=0
        else:
            bright_streak=0; dark_light_streak=0
        if bright_streak>=8: ambient_light_blocked=True
        elif dark_light_streak>=8: ambient_light_blocked=False
        if bg is None:
""",1)

s=s.replace('        if th["mode"]=="dark":\n            signed=g.astype(np.int16)-prev.astype(np.int16)\n',
'''        lowlight_mode=bool(th["mode"] in ("dark","dim"))
        if lowlight_mode:
            signed=g.astype(np.int16)-prev.astype(np.int16)
''',1)
s=s.replace("            tdiff=cv2.absdiff(compensated,prev)\n",
            "            tdiff=cv2.medianBlur(cv2.absdiff(compensated,prev),3)\n",1)
s=s.replace('        if th["mode"] in ("dark","normal"):\n',
            '        if lowlight_mode or th["mode"]=="normal":\n',1)

s=s.replace("and bbox_w>=3 and bbox_h>=5\n            and temporal_largest>=18.0\n            and fill_ratio>=0.065",
            "and bbox_w>=3 and bbox_h>=4\n            and temporal_largest>=14.0\n            and fill_ratio>=0.055",1)
s=s.replace('            th["mode"]=="dark"\n            and raw_temporal_changed>=20.0\n            and temporal_changed<=2.0\n            and temporal_largest<45.0',
            '            lowlight_mode\n            and raw_temporal_changed>=15.0\n            and temporal_changed<=2.5\n            and temporal_largest<60.0',1)
s=s.replace('            th["mode"]=="dark"\n            and temporal_changed>=16.0',
            '            lowlight_mode\n            and temporal_changed>=14.0',1)
s=s.replace("temporal_largest>=32.0 or (bbox_h>=8 and temporal_largest>=24.0)",
            "temporal_largest>=30.0 or (bbox_h>=7 and temporal_largest>=24.0)",1)
s=s.replace('        dark_temporal_ok=bool(\n            th["mode"]=="dark"',
            '        dark_temporal_ok=bool(\n            lowlight_mode',1)
s=s.replace("and temporal_changed>=0.05","and temporal_changed>=0.045",1)
s=s.replace("and temporal_coherence>=0.06","and temporal_coherence>=0.055",1)

track=re.compile(r'''        if th\["mode"\]=="dark" and dark_temporal_ok:.*?            dark_track_displacement=0\.0\n''',re.S)
replacement='''        track_step=0.0
        track_continuous=False
        if lowlight_mode and dark_temporal_ok:
            area=max(1.0,float(temporal_largest))
            if dark_track_centroid is not None and temporal_centroid is not None:
                dx=temporal_centroid[0]-dark_track_centroid[0]
                dy=temporal_centroid[1]-dark_track_centroid[1]
                track_step=(dx*dx+dy*dy)**0.5
                ratio=area/max(1.0,dark_track_area)
                track_continuous=bool(track_step<=28.0 and 0.22<=ratio<=4.5)
                if track_continuous:
                    dark_track_displacement+=track_step
                    dark_temporal_streak+=1
                else:
                    dark_temporal_streak=1
                    dark_track_displacement=0.0
            else:
                dark_temporal_streak=1
                dark_track_displacement=0.0
            dark_track_centroid=temporal_centroid
            dark_track_area=area
        else:
            dark_temporal_streak=0
            dark_track_centroid=None
            dark_track_area=0.0
            dark_track_displacement=0.0
'''
s,n=track.subn(replacement,s,count=1)
if n!=1: raise SystemExit("track patch failed")

conf=re.compile(r'''        in_dark_entry_guard=bool\(now<dark_entry_guard_until\).*?        else:\n            dark_confirmed=False\n            confirmed=bool\(candidate and candidate_streak>=th\["confirm"\]\)\n''',re.S)
replacement='''        in_dark_entry_guard=bool(now<dark_entry_guard_until)
        strict_dark_guard=bool(in_dark_entry_guard or in_transition_guard)
        guarded_dark_ok=bool(dark_temporal_ok and temporal_largest>=50.0 and temporal_coherence>=0.09 and fill_ratio>=0.07 and dark_track_displacement>=2.0)
        fast_dark_ok=bool(dark_temporal_ok and strong_component and track_continuous and dark_track_displacement>=1.2)
        cautious_dark_ok=bool(dark_temporal_ok and not strong_component and track_continuous and dark_track_displacement>=2.5)
        if lowlight_mode:
            if strict_dark_guard: dark_confirmed=bool(guarded_dark_ok and dark_temporal_streak>=3)
            elif fast_dark_ok: dark_confirmed=bool(dark_temporal_streak>=2)
            else: dark_confirmed=bool(cautious_dark_ok and dark_temporal_streak>=4)
            confirmed=dark_confirmed
        else:
            dark_confirmed=False
            confirmed=bool(candidate and candidate_streak>=th["confirm"])
'''
s,n=conf.subn(replacement,s,count=1)
if n!=1: raise SystemExit("confirm patch failed")

s=s.replace("        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:\n",
'''        trigger_eligible=bool(confirmed and not ambient_light_blocked)
        if trigger_eligible and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
''',1)
s=s.replace('            "strong_component":strong_component,\n',
'''            "strong_component":strong_component,
            "track_continuous":track_continuous,
            "track_step":round(track_step,2),
            "ambient_light_sufficient":ambient_light_blocked,
            "ambient_block_on_luma":50.0,
            "ambient_unblock_below_luma":38.0,
            "trigger_eligible":trigger_eligible,
''',1)

p.write_text(s)
py_compile.compile(str(p),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True)
time.sleep(8)
print(json.dumps(json.loads(Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json").read_text()),indent=2))
