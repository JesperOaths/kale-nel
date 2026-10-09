#!/usr/bin/env python3
from pathlib import Path
import shutil,datetime,subprocess,time,json,py_compile
p=Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
b=Path("/home/jespern/c720p-backups")/("frontcam-v14-"+datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
b.mkdir(parents=True,exist_ok=True); shutil.copy2(p,b/(p.name+".before"))
s=p.read_text()
def r(a,z,n=1):
    global s
    if a not in s: raise SystemExit("missing anchor: "+a[:40])
    s=s.replace(a,z,n)
r("TARGET_PERIOD=0.25","TARGET_PERIOD=0.20")
r("TRANSITION_MAX_SECONDS=8.0","TRANSITION_MAX_SECONDS=8.0\nAMBIENT_LIGHT_ON=42.0\nAMBIENT_LIGHT_OFF=32.0")
r("FRONTCAM_MOTION_V13 starting; adaptive-confidence dark motion; no images stored","FRONTCAM_MOTION_V14 starting; ambient-aware low-light tracking; no images stored")
s=s.replace("frontcam-motion-v13","frontcam-motion-v14").replace("FRONTCAM_MOTION_V13 stopped","FRONTCAM_MOTION_V14 stopped")
r("    flicker_reject_count=0\n    latest={}","    flicker_reject_count=0\n    ambient_luma_ema=None\n    ambient_light_sufficient=False\n    ambient_suppressed_count=0\n    latest={}")
r("            bg=g.astype(np.float32); prev=g.copy(); warm=1\n            time.sleep(TARGET_PERIOD); continue","            bg=g.astype(np.float32); prev=g.copy(); warm=1\n            ambient_luma_ema=luma\n            ambient_light_sufficient=bool(luma>=AMBIENT_LIGHT_ON)\n            time.sleep(TARGET_PERIOD); continue")
r('        if th["mode"]=="dark":\n            signed=g.astype(np.int16)-prev.astype(np.int16)','        if th["mode"] in ("dark","dim"):\n            signed=g.astype(np.int16)-prev.astype(np.int16)')
r('        if th["mode"] in ("dark","normal"):\n            tmask=cv2.morphologyEx','        if th["mode"] in ("dark","dim","normal"):\n            tmask=cv2.morphologyEx')
r("            and bbox_w>=3 and bbox_h>=5\n            and temporal_largest>=18.0\n            and fill_ratio>=0.065","            and bbox_w>=3 and bbox_h>=4\n            and temporal_largest>=16.0\n            and fill_ratio>=0.055")
r('            th["mode"]=="dark"\n            and raw_temporal_changed>=20.0','            th["mode"] in ("dark","dim")\n            and raw_temporal_changed>=8.0')
r('            th["mode"]=="dark"\n            and temporal_changed>=16.0','            th["mode"] in ("dark","dim")\n            and temporal_changed>=16.0')
r('            th["mode"]=="dark"\n            and not abrupt','            th["mode"] in ("dark","dim")\n            and not abrupt')
r('        if th["mode"]=="dark" and dark_temporal_ok:','        if th["mode"] in ("dark","dim") and dark_temporal_ok:')
r('        if th["mode"]=="dark":\n            if strict_dark_guard:','        if th["mode"] in ("dark","dim"):\n            if strict_dark_guard:')
old='''        webhook_ok=None
        webhook_status=None
        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            webhook_ok,webhook_status=post_motion()
            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
'''
new='''        if ambient_luma_ema is None: ambient_luma_ema=luma
        if abrupt: ambient_luma_ema=luma
        elif not candidate and not confirmed: ambient_luma_ema=0.92*ambient_luma_ema+0.08*luma
        if ambient_light_sufficient:
            if ambient_luma_ema<=AMBIENT_LIGHT_OFF: ambient_light_sufficient=False
        elif ambient_luma_ema>=AMBIENT_LIGHT_ON: ambient_light_sufficient=True
        lamp_trigger_allowed=not ambient_light_sufficient
        webhook_ok=None
        webhook_status=None
        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            if not lamp_trigger_allowed:
                ambient_suppressed_count+=1; last_trigger_at=now; armed=False
                log(f"motion suppressed ambient={ambient_luma_ema:.1f} luma={luma:.1f}")
                webhook_ok=None
            else:
                webhook_ok,webhook_status=post_motion()
            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
'''
r(old,new)
r('''            "motion_source":source,"luma":round(luma,1),"frame_std":round(frame_std,2),
            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
''','''            "motion_source":source,"luma":round(luma,1),"frame_std":round(frame_std,2),
            "ambient_luma":round(float(ambient_luma_ema),1),"ambient_light_sufficient":ambient_light_sufficient,
            "lamp_trigger_allowed":lamp_trigger_allowed,"ambient_suppressed_count":ambient_suppressed_count,
            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
''')
p.write_text(s); p.chmod(0o755); py_compile.compile(str(p),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(7)
print(json.dumps({"ok":True,"backup":str(b),"state":json.loads((Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json")).read_text())},indent=2))
