#!/usr/bin/env python3
"""Reversible C720P camera handoff to S9+ GPU person telemetry.

The live Security API, clip retention, and snapshot publisher stay alive.
No protected clips are removed and no Drive reserve is changed.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

CAM = pathlib.Path("/home/jespern/c720p-security-camera-new")
SRC = CAM/"c720p-frontyard-security-new.py"
CFG = CAM/"frontyard-security-config.json"
ROOT = pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
BACKUP = CAM/"backups"
MARK = "# S9_GPU_PERSON_OFFLOAD_V1"

def health(url, timeout=3):
    with urllib.request.urlopen(url,timeout=timeout) as resp:
        return json.loads(resp.read(20000).decode("utf-8"))

def good_devices():
    ml = health("http://127.0.0.1:18799/status")
    edge = health("http://127.0.0.1:18798/status")
    assert ml.get("ok") and ml.get("model_ready") and ml.get("backend") in ("gpu","nnapi","cpu"), "GPU classifier not ready"
    assert int(ml.get("frame_age_ms",99999))<3000, "GPU frame stale"
    assert edge.get("ok") and edge.get("person_ml_healthy") and edge.get("ml_capture_link_enabled"), "S9 recording handoff unavailable"
    assert edge.get("recording_armed_persistent") and edge.get("recording_enabled"), "S9 recording not armed"
    assert not edge.get("recording_orphan_present"), "S9 recording has unresolved source"
    return ml,edge

def put_atomic(path, contents):
    temp=path.with_name(path.name+".s9mlnew")
    temp.write_text(contents)
    temp.chmod(path.stat().st_mode & 0o777)
    os.replace(temp,path)

def restart():
    subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"],check=True,timeout=30)

def wait_health(seconds=24):
    deadline=time.monotonic()+seconds
    last=""
    while time.monotonic()<deadline:
        try:
            d=health("http://127.0.0.1:8793/health.json",timeout=3)
            if d.get("camera_ok") and d.get("camera_host"):
                return d
            if d.get("camera_ok"):return d
            last=str(d.get("camera_error") or d.get("last_snapshot_error") or d)
        except Exception as e:last=str(e)
        time.sleep(2)
    raise RuntimeError("camera health unavailable after restart: "+last[:250])

def apply():
    ml,edge=good_devices()
    original=SRC.read_text()
    cfg_original=CFG.read_text()
    cfg=json.loads(cfg_original)
    if MARK in original and cfg.get("motion_mode")=="s9_ml_edge":
        print("ALREADY_ACTIVE");return
    if MARK in original:raise RuntimeError("existing marker but configuration diverged, manual review needed")
    key="def get_motion(info, cfg):\n    global motion_history, latest_jpeg, motion_candidate_streak, motion_release_streak, motion_confirmed_active\n"
    assert original.count(key)==1,"motion entrypoint anchor changed"
    # Every query to ML telemetry happens on the hub's local ADB-forwarded port,
    # never exposing the phone's port to the LAN.
    branch='''    # S9_GPU_PERSON_OFFLOAD_V1
    if str(cfg.get("motion_mode","")).lower() == "s9_ml_edge":
        try:
            with urllib.request.urlopen("http://127.0.0.1:18799/status", timeout=1.2) as r:
                ml=json.loads(r.read(12000).decode("utf-8"))
            with urllib.request.urlopen("http://127.0.0.1:18798/status", timeout=1.2) as r:
                edge=json.loads(r.read(12000).decode("utf-8"))
            ml_ok=(bool(ml.get("ok")) and bool(ml.get("model_ready"))
                   and 0<=float(ml.get("frame_age_ms",-1))<3500
                   and int(ml.get("model_errors",0))==0)
            edge_ok=(bool(edge.get("ok")) and bool(edge.get("person_ml_healthy"))
                     and bool(edge.get("ml_capture_link_enabled"))
                     and bool(edge.get("recording_enabled"))
                     and not bool(edge.get("recording_orphan_present")))
            if ml_ok and edge_ok:
                conf=max(0.0,min(1.0,float(ml.get("person_confidence") or 0.0)))
                present=bool(ml.get("person_confirmed"))
                set_runtime(last_motion_poll=time.time(),
                    last_motion_active=present,
                    last_motion_value=round(conf*100.0,1),
                    last_motion_person_priority=present,
                    last_motion_mode="s9-person-ml",
                    last_motion_source="s9-gpu-ml-offload",
                    s9_ml_person_confidence=round(conf,3),
                    s9_ml_person_events=int(ml.get("person_events") or 0),
                    s9_ml_backend=str(ml.get("backend") or "unknown"),
                    s9_ml_frame_age_ms=int(ml.get("frame_age_ms") or 0),
                    s9_ml_camera_capture_owned_by_phone=True)
                # Do NOT trigger a second, disk-blocked hub-side recording.
                # S9 Edge owns capture, archival, and thumbnails.
                return False,round(conf*100.0,1)
            set_runtime(last_motion_source="s9-ml-unhealthy-software-fallback",
                        s9_ml_camera_capture_owned_by_phone=False)
        except Exception as exc:
            set_runtime(last_motion_source="s9-ml-unreachable-software-fallback",
                        s9_ml_camera_capture_owned_by_phone=False,
                        s9_ml_telemetry_error=type(exc).__name__)
        # Hard failover: existing hub detector executes below, unchanged.
'''
    new=original.replace(key,key+branch,1)
    old="if str(cfg.get('motion_mode', 'native')).lower() != 'native':"
    assert new.count(old)==1,"independent snapshot publisher anchor changed"
    new=new.replace(old,"if str(cfg.get('motion_mode', 'native')).lower() not in ('native','s9_ml_edge'):",1)
    compile(new,str(SRC),"exec")
    # preserve snapshot refresh cadence without duplicate image analysis
    cfg["motion_mode"]="s9_ml_edge"
    cfg["snapshot_refresh_seconds"]=8.0
    cfg_json=json.dumps(cfg,ensure_ascii=False,indent=2)+"\n"
    BACKUP.mkdir(parents=True,exist_ok=True)
    stamp=time.strftime("%Y%m%d-%H%M%S")
    backup_src=BACKUP/("camera-before-s9-gpu-"+stamp+".py")
    backup_cfg=BACKUP/("config-before-s9-gpu-"+stamp+".json")
    shutil.copy2(SRC,backup_src)
    shutil.copy2(CFG,backup_cfg)
    try:
        put_atomic(SRC,new)
        put_atomic(CFG,cfg_json)
        restart()
        d=wait_health()
        # Verify the phone events remain accessible after the hub restart
        ml_after,edge_after=good_devices()
        time.sleep(9)
        stamp_file=ROOT/"latest.jpg"
        if not stamp_file.is_file() or time.time()-stamp_file.stat().st_mtime>28:
            raise RuntimeError("snapshot publication stale; rolling back")
        print("S9_ML_HUB_OFFLOAD_OK")
        print(json.dumps({
            "camera_ok":d.get("camera_ok"),
            "mode":cfg["motion_mode"],
            "person_model":ml_after.get("backend"),
            "capture_armed":edge_after.get("recording_enabled"),
            "snapshot_age_seconds":round(time.time()-stamp_file.stat().st_mtime,1),
            "camera_backup":str(backup_src),
            "config_backup":str(backup_cfg)
        },sort_keys=True))
    except Exception:
        shutil.copy2(backup_src,SRC)
        shutil.copy2(backup_cfg,CFG)
        restart()
        print("ROLLBACK_RESTORED_ORIGINAL_CAMERA_MODE",file=sys.stderr)
        raise

if __name__=="__main__":
    try:apply()
    except Exception as e:
        print(type(e).__name__+": "+str(e),file=sys.stderr)
        sys.exit(1)
