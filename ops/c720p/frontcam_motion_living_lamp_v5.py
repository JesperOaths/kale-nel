#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v5-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))
s=SCRIPT.read_text()

s=s.replace('SETTLE_SECONDS=2.0','TRANSITION_MAX_SECONDS=8.0')
s=s.replace('settle_until=0.0','transition_until=0.0; transition_stable_streak=0')
s=s.replace('FRONTCAM_MOTION_V4 starting; fast dark-room motion, 2s light-transition settle; no images stored',
            'FRONTCAM_MOTION_V5 starting; stability-gated dark-room motion; no images stored')
s=s.replace('"version":"frontcam-motion-v4"','"version":"frontcam-motion-v5"')
s=s.replace('log("FRONTCAM_MOTION_V4 stopped")','log("FRONTCAM_MOTION_V5 stopped")')

old='''        # Lamp switching / auto-exposure changes most of the frame at once.
        # Snap the reference immediately and settle only two seconds. The old
        # eight-second quarantine was long enough to miss someone entering
        # just after the lamp was switched off.
        abrupt=bool(bg_changed>=50.0 or abs(luma-ref_luma)>=35.0)
        if abrupt:
            bg=g.astype(np.float32)
            prev=g.copy()
            candidate_streak=0
            settle_until=now+SETTLE_SECONDS
            candidate=False
            source="lighting-transition"
        elif now<settle_until or warm<8:
            candidate=False
            source="settling"
            candidate_streak=0
            cv2.accumulateWeighted(g,bg,0.50)
            prev=g.copy()
        else:
            bg_candidate=bool(bg_changed>=th["changed"] and bg_largest>=th["contour"])
            # Frame-to-frame evidence is especially useful in the dark, where
            # a walking silhouette can be weak against the long-term background
            # but still moves coherently between adjacent samples.
            temporal_candidate=bool(
                th["mode"] in ("dark","dim")
                and temporal_changed>=max(0.02,th["changed"]*0.65)
                and temporal_largest>=max(5.0,th["contour"]*0.65)
                and temporal_changed<45.0)
            candidate=bool(bg_candidate or temporal_candidate)
            source="temporal" if temporal_candidate and not bg_candidate else ("background" if bg_candidate else "none")
            if candidate:
                candidate_streak+=1
                last_motion_at=now
            else:
                candidate_streak=0
            cv2.accumulateWeighted(g,bg,BACKGROUND_ALPHA_MOTION if candidate else BACKGROUND_ALPHA_QUIET)
            prev=g.copy()
'''
new='''        # A lamp change is a scene-wide event. Enter a transition state rather
        # than treating it as motion. We leave that state as soon as consecutive
        # frames are stable; there is no fixed blind 8-second quarantine.
        abrupt=bool(bg_changed>=50.0 or abs(luma-ref_luma)>=35.0)
        changed_pixels=max(1.0,temporal_changed*WIDTH*HEIGHT/100.0)
        temporal_coherence=float(temporal_largest)/changed_pixels
        localized_transition_motion=bool(
            th["mode"] in ("dark","dim")
            and 0.05 <= temporal_changed <= 8.0
            and temporal_largest >= 8.0
            and temporal_coherence >= 0.12)

        if abrupt:
            bg=g.astype(np.float32)
            prev=g.copy()
            candidate_streak=0
            transition_until=now+TRANSITION_MAX_SECONDS
            transition_stable_streak=0
            candidate=False
            source="lighting-transition"
        elif now<transition_until:
            # Exposure settling is normally broad/distributed. Real nearby
            # movement is allowed through only when it is spatially localized.
            frame_luma_delta=abs(luma-float(np.mean(prev))) if prev is not None else 999.0
            stable_now=bool(temporal_changed<=1.5 and frame_luma_delta<=3.0)
            transition_stable_streak=(transition_stable_streak+1) if stable_now else 0
            if transition_stable_streak>=2:
                transition_until=0.0
                transition_stable_streak=0
                candidate=False
                source="transition-stable"
                candidate_streak=0
            elif localized_transition_motion:
                candidate=True
                source="localized-during-transition"
                candidate_streak+=1
                last_motion_at=now
            else:
                candidate=False
                source="transition-settling"
                candidate_streak=0
            cv2.accumulateWeighted(g,bg,0.50)
            prev=g.copy()
        elif warm<8:
            candidate=False
            source="warming"
            candidate_streak=0
            cv2.accumulateWeighted(g,bg,0.35)
            prev=g.copy()
        else:
            bg_candidate=bool(bg_changed>=th["changed"] and bg_largest>=th["contour"])
            temporal_candidate=bool(
                th["mode"] in ("dark","dim")
                and temporal_changed>=max(0.02,th["changed"]*0.65)
                and temporal_largest>=max(5.0,th["contour"]*0.65)
                and temporal_changed<45.0)
            candidate=bool(bg_candidate or temporal_candidate)
            source="temporal" if temporal_candidate and not bg_candidate else ("background" if bg_candidate else "none")
            if candidate:
                candidate_streak+=1
                last_motion_at=now
            else:
                candidate_streak=0
            cv2.accumulateWeighted(g,bg,BACKGROUND_ALPHA_MOTION if candidate else BACKGROUND_ALPHA_QUIET)
            prev=g.copy()
'''
if old not in s:
    raise SystemExit("V5 candidate anchor not found")
s=s.replace(old,new,1)

old_state='''            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
            "settling":bool(now<settle_until),"candidate":candidate,
'''
new_state='''            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
            "transition_guard":bool(now<transition_until),
            "transition_stable_streak":transition_stable_streak,
            "temporal_coherence":round(temporal_coherence,3),
            "localized_transition_motion":localized_transition_motion,
            "candidate":candidate,
'''
if old_state not in s:
    raise SystemExit("V5 state anchor not found")
s=s.replace(old_state,new_state,1)

SCRIPT.write_text(s)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(["systemctl","--user","restart","c720p-frontcam-motion-living-lamp.service"],check=True,timeout=30)
time.sleep(8)
show=subprocess.run(["systemctl","--user","show","c720p-frontcam-motion-living-lamp.service","-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
                    text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-v5","backup":str(BACKUP),"service":show,"state":state},indent=2))
