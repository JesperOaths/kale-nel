#!/usr/bin/env python3
"""Guarded C720P motion V18 upgrade.

Read-only, including all assertions, unless --apply is provided.
Only modify the C720P camera detector service. Preserve HA manual ownership,
night V17 shape evidence, outgoing management agent and camera backups.
"""
import argparse
import ast
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time

SOURCE = pathlib.Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
STATE = pathlib.Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json")
BACKUP = pathlib.Path("/home/jespern/c720p-backups/living-lamp-v18-normal-motion-20261011/frontcam-v17.before.py")
UNIT = "c720p-frontcam-motion-living-lamp.service"
EXPECTED_SHA = "644f29858892a5b61c3b042e7e42a06026c5851318e080991e226b51b995bbc8"
MARKER = "NORMAL_MOTION_V18_20261011"

NORMAL_HELPER = '''
# NORMAL_MOTION_V18_20261011
# At 160x120, moderate frame-to-frame person movement can fail the old
# 18-level/95-contour background-only trigger. Use localized temporal
# evidence in normal lighting; the proven V17 dark gate stays unchanged.
def normal_motion_evidence(changed, largest, coherence, bbox, background_supported=False):
    if not bbox:
        return False
    _, _, w, h = bbox
    if w < 6 or h < 7 or changed > 35.0:
        return False
    temporal = changed >= 0.12 and largest >= 24.0 and coherence >= 0.10
    supported = (background_supported and changed >= 0.07
                 and largest >= 18.0 and coherence >= 0.08)
    return bool(temporal or supported)

def night_motion_source_ok(source, transition_guard):
    # A verified incident at 21:23 passed the V17 shape gate while still
    # tagged localized-during-transition. A normal scene transition must
    # never switch an OFF lamp on, even when its contour resembles a person.
    return bool(source in ("background","temporal") and not transition_guard)
'''

NORMAL_OLD = 'return {"mode":"normal","delta":18,"changed":0.65,"contour":95.0,"confirm":2}'
NORMAL_NEW = 'return {"mode":"normal","delta":12,"changed":0.30,"contour":60.0,"confirm":2}'
CANDIDATE_OLD = '''            candidate=bool(bg_candidate or temporal_candidate)
            source="temporal" if temporal_candidate and not bg_candidate else ("background" if bg_candidate else "none")
'''
CANDIDATE_NEW = '''            if th["mode"] == "normal":
                normal_temporal_candidate=normal_motion_evidence(
                    temporal_changed, temporal_largest, live_coherence, temporal_bbox,
                    background_supported=bg_candidate)
                candidate=bool(normal_temporal_candidate)
                source="temporal-normal-v18" if candidate else "none"
            else:
                candidate=bool(bg_candidate or temporal_candidate)
                source="temporal" if temporal_candidate and not bg_candidate else ("background" if bg_candidate else "none")
'''
DARK_CONFIRM_OLD = "confirmed=bool(dark_confirmed and dark_shape_gate_ok)"
DARK_CONFIRM_NEW = '''confirmed=bool(dark_confirmed and dark_shape_gate_ok
                           and night_motion_source_ok(source,in_transition_guard))'''

def replace_once(text, old, new, why):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{why}: expected 1 anchor, got {count}")
    return text.replace(old, new, 1)

def proposed(current):
    if MARKER in current:
        return current, True
    h = hashlib.sha256(current.encode()).hexdigest()
    if h != EXPECTED_SHA:
        raise RuntimeError("detector source differs from audited V17; refusing blind patch")
    if "NIGHT_SHAPE_GATE_V17_20261011" not in current:
        raise RuntimeError("missing protected V17 nighttime shape gate")
    s = replace_once(current, "def metrics(mask):", NORMAL_HELPER + "\ndef metrics(mask):", "pure evidence helper")
    s = replace_once(s, NORMAL_OLD, NORMAL_NEW, "normal profile")
    s = replace_once(s, CANDIDATE_OLD, CANDIDATE_NEW, "normal candidate split")
    s = replace_once(s, DARK_CONFIRM_OLD, DARK_CONFIRM_NEW, "dark transition source veto")
    s = replace_once(s, "        now=time.time()\n", "        now=time.time()\n        normal_temporal_candidate=False\n", "initialize normal evidence")
    s = replace_once(s, '            "candidate":candidate,\n',
                     '            "candidate":candidate,\n            "normal_motion_v18":True,\n            "normal_temporal_candidate":normal_temporal_candidate,\n',
                     "status evidence")
    s = s.replace('"frontcam-motion-v16"', '"frontcam-motion-v18"')
    s = s.replace('FRONTCAM_MOTION_V16', 'FRONTCAM_MOTION_V18')
    compile(s, str(SOURCE), "exec")
    return s, False

def validate(updated):
    astree = ast.parse(updated, filename=str(SOURCE))
    ns = {}
    funcs = [x for x in astree.body
             if isinstance(x, ast.FunctionDef) and x.name in
             ("night_lamp_shape_gate","normal_motion_evidence","thresholds","night_motion_source_ok")]
    if len(funcs) != 4:
        raise RuntimeError("missing V17/V18 helpers after patch")
    exec(compile(ast.Module(body=funcs, type_ignores=[]),str(SOURCE),"exec"),ns)
    night=ns["night_lamp_shape_gate"]
    normal=ns["normal_motion_evidence"]
    source_ok=ns["night_motion_source_ok"]
    cases = [
      ("old_false_1918",False,night((70,98,17,14),146,.90,4,4.0,.35)),
      ("old_false_1937",False,night((7,71,9,10),36,2.09,4,4.0,.33)),
      ("old_false_1950",False,night((0,71,13,21),64,2.50,4,4.0,.22)),
      ("old_false_2012",False,night((0,76,10,9),38,2.57,4,4.0,.39)),
      ("old_false_2051",False,night((11,68,10,19),47,2.22,4,4.0,.24)),
      ("old_false_2053",False,night((11,66,10,14),53,3.52,4,4.0,.36)),
      ("walking_dark_a",True,night((30,20,28,45),305,3.4,4,8.0,.26)),
      ("walking_dark_b",True,night((84,25,24,35),211,2.0,3,4.0,.25)),
      ("walking_normal_a",True,normal(.65,75,.35,(30,20,18,26))),
      ("walking_normal_b",True,normal(.085,19,.15,(30,20,7,10),True)),
      ("idle_normal",False,normal(0.,0.,0.,None)),
      ("tiny_patch_normal",False,normal(.4,10,.8,(2,2,4,4))),
      ("incoherent_normal",False,normal(1.2,33,.02,(20,20,15,15))),
      ("global_flicker_normal",False,normal(60.,9000.,1.,(0,0,160,120))),
      ("unmoving_background",False,normal(.01,0.,0.,(20,20,30,40),True)),
      # These two false ONs occurred on the actual C720P after V17 cutover.
      ("false_2107_transition_settling",False,
       night((24,62,30,52),1071,8.40,3,3,.50)
       and source_ok("transition-settling",True)),
      ("false_2123_localized_transition",False,
       night((0,80,22,40),700,7.36,3,3,.50)
       and source_ok("localized-during-transition",True)),
      ("dark_light_transition",False,source_ok("lighting-transition",True)),
      ("normal_dark_background",True,source_ok("background",False)),
      ("normal_dark_temporal",True,source_ok("temporal",False)),
      ("dark_temporal_guarded",False,source_ok("temporal",True)),
    ]
    fail=[n for n,expected,actual in cases if bool(actual)!=expected]
    if ns["thresholds"](110)["delta"] != 12:
        fail.append("normal_threshold_not_updated")
    if ns["thresholds"](8)["delta"] != 1:
        fail.append("dark_threshold_changed")
    if 'and night_motion_source_ok(source,in_transition_guard)' not in updated:
        fail.append("transition_veto_not_integrated")
    if fail:raise RuntimeError("regression failures: "+repr(fail))
    return {"cases":len(cases)+2,"passed":len(cases)+2,"night_v17_unchanged":True,
            "normal_profile":"delta12/changed0.30/contour60",
            "transition_settling_and_localized_blocked":True}

def active():
    p=subprocess.run(["systemctl","--user","is-active",UNIT],
                     capture_output=True,text=True,timeout=8)
    return p.returncode==0 and p.stdout.strip()=="active"

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true",help="install and guarded restart")
    a=parser.parse_args()
    old=SOURCE.read_text()
    new,already=proposed(old)
    tests=validate(new)
    report={"mode":"apply" if a.apply else "dry_run","already_installed":already,
            "verified_source_sha":hashlib.sha256(old.encode()).hexdigest()[:20],
            "validation":tests,"backup_exists":BACKUP.exists()}
    if not a.apply or already:
        print(json.dumps(report,separators=(",",":")))
        return
    if BACKUP.exists():
        raise RuntimeError("backup path exists; refuse overwrite")
    if not active():
        raise RuntimeError("service was not active before cutover")
    BACKUP.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(SOURCE,BACKUP)
    staged=SOURCE.with_suffix(".py.v18-tmp")
    staged.write_text(new)
    os.chmod(staged,SOURCE.stat().st_mode & 0o777)
    os.replace(staged,SOURCE)
    try:
        r=subprocess.run(["systemctl","--user","restart",UNIT],timeout=17,
                         capture_output=True,text=True)
        if r.returncode != 0:raise RuntimeError("restart failed")
        time.sleep(4)
        if not active():raise RuntimeError("service inactive after restart")
        state=json.loads(STATE.read_text())
        if (state.get("version")!="frontcam-motion-v18"
            or not state.get("ok") or state.get("camera_failures")!=0
            or time.time()-float(state.get("updated_at",0))>6):
            raise RuntimeError("fresh camera state/label/health check failed")
    except Exception:
        shutil.copy2(BACKUP,SOURCE)
        subprocess.run(["systemctl","--user","restart",UNIT],timeout=18)
        raise
    report.update({"status":"installed","service_active":active(),
                   "fresh_state":True,"source_backup":str(BACKUP)})
    print(json.dumps(report,separators=(",",":")))

if __name__=="__main__":
    main()
