#!/usr/bin/env python3
"""Guarded, idempotent C720P front-camera low-light motion hardening.

Use on the C720P when restoring or reinstalling the camera motion detector.
No image capture, credentials, lamp commands or public network endpoints.
Run with --check to inspect; --apply to patch with backup and rollback.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
STATE = Path("/home/jespern/c720p-home-hub/state/frontcam-motion-living-lamp.json")
BACKUP = Path("/home/jespern/c720p-backups/frontcam-night-shape-gate-20261011/frontcam-motion-v16.before.py")
UNIT = "c720p-frontcam-motion-living-lamp.service"
MARKER = "NIGHT_SHAPE_GATE_V17_20261011"

HELPER = """
# NIGHT_SHAPE_GATE_V17_20261011
# Ignore tiny low-light camera-noise components for lamp activation.
# Manual lamp control and daylight behavior are unchanged.
def night_lamp_shape_gate(bbox, area, changed, streak, displacement, fill):
    if not bbox:
        return False
    x, y, w, h = bbox
    return bool(
        w >= 14 and h >= 16
        and area >= 80.0 and changed >= 0.40
        and streak >= 3 and displacement >= 3.0
        and fill >= 0.08
        and not (x <= 2 and w < 22)
    )
"""

def patch(source: str) -> str:
    if MARKER in source:
        return source
    anchor1 = "\ndef metrics(mask):"
    anchor2 = '        if th["mode"] in ("dark","dim"):\n            if strict_dark_guard:'
    anchor3 = "            confirmed=dark_confirmed\n"
    if any(source.count(x) != 1 for x in (anchor1, anchor2, anchor3)):
        raise RuntimeError("unexpected_detector_version_or_layout")
    out = source.replace(anchor1, "\n" + HELPER + anchor1, 1)
    out = out.replace(anchor2, '        dark_shape_gate_ok=False\n' + anchor2, 1)
    out = out.replace(
        anchor3,
        "            dark_shape_gate_ok=night_lamp_shape_gate(temporal_bbox,temporal_largest,temporal_changed,dark_temporal_streak,dark_track_displacement,fill_ratio)\n"
        "            confirmed=bool(dark_confirmed and dark_shape_gate_ok)\n", 1,
    )
    diagnostic = '            "dark_confirmed":dark_confirmed,'
    if out.count(diagnostic) == 1:
        out = out.replace(
            diagnostic,
            diagnostic + '\n            "night_shape_gate_v17":True,\n            "night_shape_gate_ok":dark_shape_gate_ok,', 1,
        )
    compile(out, str(TARGET), "exec")
    return out

def verify_test_patterns(code: str) -> dict:
    tree = ast.parse(code)
    node = next(x for x in tree.body
                if isinstance(x, ast.FunctionDef) and x.name == "night_lamp_shape_gate")
    globals_ = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<guard-only>", "exec"), globals_)
    fn = globals_["night_lamp_shape_gate"]
    negatives = [
        ((80,99,9,7),26,.59,4,5,.16),
        ((70,98,17,14),146,.9,5,7,.35),
        ((7,71,9,10),36,2.09,6,6,.40),
        ((0,71,13,21),64,2.50,6,6,.23),
        ((0,76,10,9),38,2.57,6,6,.42),
        ((11,68,10,19),47,2.22,6,6,.24),
    ]
    positives = [
        ((40,30,28,36),260,2.2,4,8,.26),
        ((35,42,16,22),92,.81,4,4,.26),
    ]
    result = {
        "historic_false_blocked":sum(not fn(*v) for v in negatives),
        "historic_total":len(negatives),
        "synthetic_walking_allowed":sum(fn(*v) for v in positives),
        "synthetic_total":len(positives),
    }
    if result["historic_false_blocked"] != len(negatives) or result["synthetic_walking_allowed"] != len(positives):
        raise RuntimeError("regression_test_failed")
    return result

def unit_active() -> bool:
    r = subprocess.run(["systemctl", "--user", "is-active", UNIT],
                       capture_output=True, text=True, timeout=5)
    return r.returncode == 0 and r.stdout.strip() == "active"

def restart() -> None:
    subprocess.run(["systemctl", "--user", "restart", UNIT], check=True, timeout=18)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="make a guarded local change")
    args = parser.parse_args()
    source = TARGET.read_text()
    new = patch(source)
    checks = verify_test_patterns(new)
    if not args.apply or new == source:
        print(json.dumps({"status":"already_installed" if new == source else "ready",
                          "service_active":unit_active(), "tests":checks}))
        return
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        shutil.copy2(TARGET, BACKUP)
    tmp = TARGET.with_suffix(".py.v17.tmp")
    tmp.write_text(new)
    os.chmod(tmp, stat.S_IMODE(TARGET.stat().st_mode))
    os.replace(tmp, TARGET)
    began = time.time()
    try:
        restart()
        for _ in range(25):
            if unit_active() and STATE.exists() and STATE.stat().st_mtime > began + 1:
                if json.loads(STATE.read_text()).get("night_shape_gate_v17") is True:
                    print(json.dumps({"status":"installed","tested":checks,
                                      "service_active":True,"backup":str(BACKUP)}))
                    return
            time.sleep(.5)
        raise RuntimeError("service_not_reporting_new_guard")
    except Exception:
        shutil.copy2(BACKUP, TARGET)
        restart()
        raise

if __name__ == "__main__":
    main()
