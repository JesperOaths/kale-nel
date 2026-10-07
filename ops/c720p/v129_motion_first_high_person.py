#!/usr/bin/env python3
from __future__ import annotations

import datetime
import json
import os
import pathlib
import py_compile
import re
import shutil
import subprocess
import time

HOME = pathlib.Path("/home/jespern")
CAM = HOME / "c720p-security-camera-new"
APP = CAM / "c720p-frontyard-security-new.py"
CFG = CAM / "frontyard-security-config.json"
ROOT = pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
UNIT = HOME / ".config/systemd/user/c720p-frontyard-security-new.service"
BACKFILL_TIMER = HOME / ".config/systemd/user/c720p-night-vehicle-backfill-v127.timer"
HUB_STATE = HOME / "c720p-home-hub/state"
STAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP = HOME / "c720p-backups" / f"motion-first-person-v129-{STAMP}"
BACKUP.mkdir(parents=True, exist_ok=True)

def backup(path: pathlib.Path):
    if path.exists():
        shutil.copy2(path, BACKUP / (path.name + ".before"))

for p in (APP, CFG, UNIT, BACKFILL_TIMER):
    backup(p)

src = APP.read_text()

# Add cheap person-biased geometry and soft road vehicle rejection to the
# existing 192x108 motion analysis. This does not add any neural inference.
anchor = """    component=_largest_coherent_motion_component(changed,nuisance,width,height)
    coherent_enabled=bool(cfg.get('motion_coherent_enabled',True))
"""
replacement = """    component=_largest_coherent_motion_component(changed,nuisance,width,height)

    # V129 motion-first person lane. Work only with the coherent-motion box we
    # already computed, so the extra cost is negligible compared with fetching
    # and decoding the snapshot itself. The goal is high recall for a walking
    # person, including a person crossing the roadway, while still rejecting an
    # obvious wide/low vehicle-shaped blob that stays in the road band.
    bbox=component.get('bbox')
    comp_aspect=0.0
    road_overlap=0.0
    road_vehicle_like=False
    person_motion=False
    if bbox:
        bx0,by0,bx1,by1=[float(v) for v in bbox]
        bwc=max(1.0,bx1-bx0); bhc=max(1.0,by1-by0)
        comp_aspect=bhc/bwc
        box_area=max(1.0,bwc*bhc)
        for rr in (cfg.get('motion_road_rects') or []):
            try:
                rx0=max(0.0,min(float(width),float(rr.get('x',0))*width))
                ry0=max(0.0,min(float(height),float(rr.get('y',0))*height))
                rx1=max(rx0,min(float(width),(float(rr.get('x',0))+float(rr.get('w',0)))*width))
                ry1=max(ry0,min(float(height),(float(rr.get('y',0))+float(rr.get('h',0)))*height))
            except Exception:
                continue
            ox=max(0.0,min(bx1,rx1)-max(bx0,rx0))
            oy=max(0.0,min(by1,ry1)-max(by0,ry0))
            road_overlap=max(road_overlap,(ox*oy)/box_area)
        person_min_pixels=int(cfg.get(f'motion_{mode}_person_min_pixels', {'dark':36,'twilight':30,'day':24}[mode]))
        person_motion=bool(
            cfg.get('motion_person_priority_enabled',True)
            and not global_change
            and changed_pct >= float(cfg.get('motion_person_min_changed_percent',0.08))
            and int(component.get('pixels') or 0) >= person_min_pixels
            and int(component.get('width') or 0) >= int(cfg.get('motion_person_min_width',3))
            and int(component.get('height') or 0) >= int(cfg.get('motion_person_min_height',7))
            and float(component.get('density') or 0.0) >= float(cfg.get('motion_person_min_density',0.12))
            and comp_aspect >= float(cfg.get('motion_person_min_height_width_ratio',0.55))
        )
        road_vehicle_like=bool(
            cfg.get('motion_soft_road_vehicle_suppress_enabled',True)
            and road_overlap >= float(cfg.get('motion_road_vehicle_min_overlap',0.72))
            and int(component.get('width') or 0) >= int(cfg.get('motion_road_vehicle_min_width',18))
            and bwc >= bhc * float(cfg.get('motion_road_vehicle_min_width_height_ratio',2.4))
            and not person_motion
        )

    coherent_enabled=bool(cfg.get('motion_coherent_enabled',True))
"""
if "motion-first person lane" not in src:
    if anchor not in src:
        raise SystemExit("V129 motion geometry anchor missing")
    src = src.replace(anchor, replacement, 1)

old = """    area_candidate=bool(changed_pct >= required_pct and hot_blocks >= min_hot_blocks and not global_change)
    candidate=bool(area_candidate or coherent_candidate)
    return {'candidate':candidate,'area_candidate':area_candidate,'coherent_candidate':coherent_candidate,'coherent_pixels':int(component['pixels']),'coherent_bbox':component['bbox'],'coherent_width':int(component['width']),'coherent_height':int(component['height']),'coherent_density':round(float(component['density']),4),'coherent_min_pixels':coherent_min_pixels,'mode':mode,'p80':float(p80),'delta':int(delta),'changed_pct':float(changed_pct),'mean_diff':float(mean_diff),'hot_blocks':int(hot_blocks),'min_hot_blocks':int(min_hot_blocks),'total_blocks':int(total_blocks),'max_block_pct':float(max_block_pct),'global_change':bool(global_change),'nuisance_coverage':round(float(nuisance_coverage),3),'nuisance_suppressed':int(nuisance_suppressed),'nuisance_delta':int(nuisance_delta),'noise_range_p95':float(noise_p95),'noise_suppressed':int(noise_suppressed),'static_exclusion_coverage':round(float(static_exclusion_coverage),3),'static_exclusion_suppressed':int(static_exclusion_suppressed)}
"""
new = """    area_candidate=bool(changed_pct >= required_pct and hot_blocks >= min_hot_blocks and not global_change)
    candidate=bool(person_motion or ((area_candidate or coherent_candidate) and not road_vehicle_like))
    return {'candidate':candidate,'person_motion':bool(person_motion),'road_vehicle_like':bool(road_vehicle_like),'road_overlap':round(float(road_overlap),4),'component_aspect':round(float(comp_aspect),4),'area_candidate':area_candidate,'coherent_candidate':coherent_candidate,'coherent_pixels':int(component['pixels']),'coherent_bbox':component['bbox'],'coherent_width':int(component['width']),'coherent_height':int(component['height']),'coherent_density':round(float(component['density']),4),'coherent_min_pixels':coherent_min_pixels,'mode':mode,'p80':float(p80),'delta':int(delta),'changed_pct':float(changed_pct),'mean_diff':float(mean_diff),'hot_blocks':int(hot_blocks),'min_hot_blocks':int(min_hot_blocks),'total_blocks':int(total_blocks),'max_block_pct':float(max_block_pct),'global_change':bool(global_change),'nuisance_coverage':round(float(nuisance_coverage),3),'nuisance_suppressed':int(nuisance_suppressed),'nuisance_delta':int(nuisance_delta),'noise_range_p95':float(noise_p95),'noise_suppressed':int(noise_suppressed),'static_exclusion_coverage':round(float(static_exclusion_coverage),3),'static_exclusion_suppressed':int(static_exclusion_suppressed)}
"""
if "'person_motion':bool(person_motion)" not in src:
    if old not in src:
        raise SystemExit("V129 motion result anchor missing")
    src = src.replace(old, new, 1)

old = """    raw_candidate=bool(analysis['candidate']); instant_strong=_motion_instant_strong(analysis,cfg); active=_motion_state_update(raw_candidate,cfg)
    if instant_strong and not active:
"""
new = """    raw_candidate=bool(analysis['candidate']); person_priority=bool(analysis.get('person_motion')); instant_strong=_motion_instant_strong(analysis,cfg); active=_motion_state_update(raw_candidate,cfg)
    if person_priority and raw_candidate and not active:
        # A human-shaped coherent blob gets a shorter confirmation path than
        # generic motion. Two one-second observations is the default; one-frame
        # triggering remains reserved for the existing very-strong-motion rule.
        person_confirm=max(1,int(cfg.get('motion_person_confirm_frames',2)))
        if motion_candidate_streak >= person_confirm:
            motion_release_streak=0
            motion_confirmed_active=True
            active=True
    if instant_strong and not active:
"""
if "person_priority=bool(analysis.get('person_motion'))" not in src:
    if old not in src:
        raise SystemExit("V129 confirmation anchor missing")
    src = src.replace(old, new, 1)

old = """    return active,score


def atomic_write(path, data):
"""
new = """    set_runtime(last_motion_person_priority=bool(analysis.get('person_motion')),
                last_motion_road_vehicle_like=bool(analysis.get('road_vehicle_like')),
                last_motion_road_overlap=analysis.get('road_overlap'),
                last_motion_component_aspect=analysis.get('component_aspect'))
    return active,score


def atomic_write(path, data):
"""
if "last_motion_person_priority=bool(analysis.get('person_motion'))" not in src:
    if old not in src:
        raise SystemExit("V129 runtime anchor missing")
    src = src.replace(old, new, 1)

old = """            score = float(motion_value or 0.0)
            strong = score >= float(cfg.get('recording_strong_motion_percent', 5.0))
"""
new = """            score = float(motion_value or 0.0)
            person_priority = bool(runtime.get('last_motion_person_priority'))
            strong = person_priority or score >= float(cfg.get('recording_strong_motion_percent', 5.0))
"""
if "person_priority = bool(runtime.get('last_motion_person_priority'))" not in src:
    if old not in src:
        raise SystemExit("V129 rate priority anchor missing")
    src = src.replace(old, new, 1)

old = """            min_interval = float(cfg.get('recording_strong_min_interval_seconds', 60.0)) if strong else float(cfg.get('cooldown_seconds', 90.0))
            set_runtime(recording_rate_window_count=len(trigger_history), recording_rate_limited=bool(rate_limited), recording_rate_limit_class=('strong-emergency' if strong else 'low-confidence'))
"""
new = """            if person_priority:
                min_interval = float(cfg.get('recording_person_min_interval_seconds', 30.0))
            else:
                min_interval = float(cfg.get('recording_strong_min_interval_seconds', 60.0)) if strong else float(cfg.get('cooldown_seconds', 90.0))
            set_runtime(recording_rate_window_count=len(trigger_history), recording_rate_limited=bool(rate_limited), recording_rate_limit_class=('person-priority' if person_priority else ('strong-emergency' if strong else 'low-confidence')))
"""
if "recording_person_min_interval_seconds" not in src:
    if old not in src:
        raise SystemExit("V129 interval anchor missing")
    src = src.replace(old, new, 1)

APP.write_text(src)
py_compile.compile(str(APP), doraise=True)

cfg = json.loads(CFG.read_text())
old_road = list(cfg.get("motion_static_exclusion_rects") or [])
if not cfg.get("motion_road_rects"):
    cfg["motion_road_rects"] = old_road or [{"name":"roadway","x":0.0,"y":0.34,"w":1.0,"h":0.22}]
# Do not hard-ignore the road: a person crossing it must remain detectable.
cfg["motion_static_exclusion_rects"] = []
cfg["motion_static_exclusion_policy"] = "v129-soft-road-vehicle-shape-suppression-high-person-recall"
cfg.update({
    "motion_person_priority_enabled": True,
    "motion_person_confirm_frames": 2,
    "motion_dark_person_min_pixels": 36,
    "motion_twilight_person_min_pixels": 30,
    "motion_day_person_min_pixels": 24,
    "motion_person_min_changed_percent": 0.08,
    "motion_person_min_width": 3,
    "motion_person_min_height": 7,
    "motion_person_min_density": 0.12,
    "motion_person_min_height_width_ratio": 0.55,
    "motion_soft_road_vehicle_suppress_enabled": True,
    "motion_road_vehicle_min_overlap": 0.72,
    "motion_road_vehicle_min_width": 18,
    "motion_road_vehicle_min_width_height_ratio": 2.4,
    "recording_person_min_interval_seconds": 30.0,
})
tmp = CFG.with_suffix(".json.tmp-v129")
tmp.write_text(json.dumps(cfg, indent=2) + "\n")
os.replace(tmp, CFG)

# Clear only snapshots that are no longer referenced by the live event index.
# Archived playback has its own Drive thumbnail store; current event snapshots stay.
events = json.loads((ROOT / "events.json").read_text())
if isinstance(events, dict):
    events = events.get("events", [])
live_snaps = {pathlib.Path(str(x.get("snapshot") or "")).name for x in events if x.get("snapshot")}
deleted_snaps = 0
deleted_bytes = 0
for p in (ROOT / "snaps").glob("*"):
    if p.is_file() and p.name not in live_snaps:
        try:
            n = p.stat().st_size
            p.unlink()
            deleted_snaps += 1
            deleted_bytes += n
        except Exception:
            pass

# Historical deep revalidation is not urgent. Keep it enabled but make it rare
# so live motion/recording always wins on this two-core Celeron.
if BACKFILL_TIMER.exists():
    s = BACKFILL_TIMER.read_text()
    s = re.sub(r"^OnUnitActiveSec=.*$", "OnUnitActiveSec=6h", s, flags=re.M)
    s = re.sub(r"^RandomizedDelaySec=.*$", "RandomizedDelaySec=15m", s, flags=re.M)
    BACKFILL_TIMER.write_text(s)

subprocess.run(["systemctl","--user","daemon-reload"], check=True, timeout=20)
if BACKFILL_TIMER.exists():
    subprocess.run(["systemctl","--user","restart",BACKFILL_TIMER.name], check=False, timeout=20)

# Restart only the camera motion service, then verify it stays up.
subprocess.run(["systemctl","--user","restart","c720p-frontyard-security-new.service"], check=True, timeout=30)
time.sleep(6)
active = subprocess.run(["systemctl","--user","is-active","c720p-frontyard-security-new.service"], text=True, capture_output=True, timeout=10).stdout.strip()
if active != "active":
    raise SystemExit("V129 camera service failed to stay active: " + active)

# Keep classifier work background-only; it is not part of the recording trigger.
timer_show = ""
if BACKFILL_TIMER.exists():
    timer_show = subprocess.run(
        ["systemctl","--user","show",BACKFILL_TIMER.name,"-p","NextElapseUSecRealtime","-p","ActiveState"],
        text=True,capture_output=True,timeout=10
    ).stdout.strip()

free_mb = round(shutil.disk_usage(ROOT).free / 1048576, 1)
report = {
    "ok": True,
    "version": "v129-motion-first-high-person",
    "backup": str(BACKUP),
    "camera_service": active,
    "analysis_resolution": [int(cfg.get("motion_analysis_width",192)), int(cfg.get("motion_analysis_height",108))],
    "motion_poll_seconds": cfg.get("motion_poll_seconds"),
    "generic_confirm_frames": cfg.get("motion_confirm_frames"),
    "person_confirm_frames": cfg.get("motion_person_confirm_frames"),
    "road_policy": cfg.get("motion_static_exclusion_policy"),
    "hard_exclusion_rects": cfg.get("motion_static_exclusion_rects"),
    "road_rects": cfg.get("motion_road_rects"),
    "orphan_snapshots_deleted": deleted_snaps,
    "orphan_snapshot_mb_freed": round(deleted_bytes/1048576,1),
    "free_mb_after": free_mb,
    "backfill_timer": timer_show,
    "neural_inference_in_motion_trigger": False,
}
(HUB_STATE / "motion-first-v129-last.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report, indent=2))
