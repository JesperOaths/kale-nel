#!/usr/bin/env python3
"""Guarded patch for C720P frontcam v16 false lamp-on events.

Run only through an authorized operator's tested C720P maintenance path.
This does not execute automatically from GitHub.
"""
from pathlib import Path
import os, shutil, subprocess, time

SRC = Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
BACKUP = Path("/home/jespern/c720p-backups/living-lamp-dark-false-motion-20261011/c720p-frontcam-motion-living-lamp.py.before")
NEEDLE = "lamp_trigger_allowed=not (ambient_light_sufficient or ambient_light_blocked)"
MARKER = "STEP_20261011_DARK_LAMP_ON_EVIDENCE_GUARD"
ADDITION = """# STEP_20261011_DARK_LAMP_ON_EVIDENCE_GUARD
        # Ignore tiny dark-frame contours when deciding to turn an OFF lamp on.
        # Continue publishing motion events for camera-owned timer refresh.
        meaningful_dark_lamp_on=bool(
            temporal_bbox and bbox_w >= 18 and bbox_h >= 16
            and temporal_largest >= 90.0
            and temporal_coherence >= 0.12
            and dark_track_displacement >= 3.0
            and dark_temporal_streak >= 3
            and not global_flicker_like
            and not in_dark_entry_guard
            and not in_transition_guard)
        lamp_trigger_allowed=not (ambient_light_sufficient or ambient_light_blocked)
        if th["mode"] in ("dark","dim") and not meaningful_dark_lamp_on:
            lamp_trigger_allowed=False
"""

def main():
    original = SRC.read_text()
    # A newer, tested V17 shape gate is already running on C720P. Never stack
    # this historical V16 draft on top of V17 or overwrite its tuning.
    if "NIGHT_SHAPE_GATE_V17_20261011" in original:
        print("superseded_by_live_v17_night_shape_gate; no changes made")
        return 0
    if MARKER in original:
        print("already_installed")
        return 0
    if original.count(NEEDLE) != 1 or "frontcam-motion-v16" not in original:
        raise RuntimeError("unexpected frontcam version or anchor")
    changed = original.replace(NEEDLE, ADDITION, 1)
    compile(changed, str(SRC), "exec")
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    if BACKUP.exists():
        raise RuntimeError("existing backup; inspect manually before overwriting")
    shutil.copy2(SRC, BACKUP)
    staged = SRC.with_suffix(".py.step4-staged")
    staged.write_text(changed)
    os.chmod(staged, SRC.stat().st_mode & 0o777)
    os.replace(staged, SRC)
    service = "c720p-frontcam-motion-living-lamp.service"
    restart = subprocess.run(["systemctl", "--user", "restart", service], timeout=15)
    time.sleep(2)
    healthy = subprocess.run(["systemctl", "--user", "is-active", "--quiet", service], timeout=5).returncode == 0
    if restart.returncode != 0 or not healthy:
        shutil.copy2(BACKUP, SRC)
        subprocess.run(["systemctl", "--user", "restart", service], timeout=15)
        raise RuntimeError("service failed; original restored")
    print("installed; service active; rollback saved")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
