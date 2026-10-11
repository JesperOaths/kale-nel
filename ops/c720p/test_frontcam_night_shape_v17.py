#!/usr/bin/env python3
"""Read-only regression tests for the installed C720P V17 dark-motion gate.

Parses and evaluates ONLY the pure night_lamp_shape_gate function from
C720P's local source; does not open the camera, send a Home Assistant webhook,
switch a lamp, or import the rest of the detector.
"""
import ast
import json
from pathlib import Path

SOURCE = Path("/home/jespern/c720p-home-hub/bin/c720p-frontcam-motion-living-lamp.py")
MARKER = "NIGHT_SHAPE_GATE_V17_20261011"

# name, bounding box, contour area, changed %, tracked frames, tracked motion,
# blob fill ratio, expected eligibility.
CASES = [
    ("false_1918", (70, 98, 17, 14), 146, .90, 4, 4., .35, False),
    ("false_1937", (7, 71, 9, 10), 36, 2.09, 4, 4., .33, False),
    ("false_1950", (0, 71, 13, 21), 64, 2.50, 4, 4., .22, False),
    ("false_2012", (0, 76, 10, 9), 38, 2.57, 4, 4., .39, False),
    ("false_2051", (11, 68, 10, 19), 47, 2.22, 4, 4., .24, False),
    ("false_2053", (11, 66, 10, 14), 53, 3.52, 4, 4., .36, False),
    ("walking_like_a", (30, 20, 28, 45), 305, 3.4, 4, 8., .26, True),
    ("walking_like_b", (84, 25, 24, 35), 211, 2., 3, 4., .25, True),
    ("camera_border_noise", (0, 40, 20, 30), 201, 1.8, 4, 5., .4, False),
    ("stationary_object", (65, 30, 30, 43), 320, 1.9, 4, 0., .25, False),
    ("brief_flicker", (60, 30, 32, 40), 320, 2., 2, 6., .25, False),
    ("weak_patches", (64, 30, 30, 42), 75, 1.9, 4, 6., .25, False),
]

def main():
    src = SOURCE.read_text()
    if MARKER not in src:
        raise SystemExit("FAIL: expected live V17 marker was not present")
    tree = ast.parse(src, filename=str(SOURCE))
    funcs = [n for n in tree.body
             if isinstance(n, ast.FunctionDef) and n.name == "night_lamp_shape_gate"]
    if len(funcs) != 1:
        raise SystemExit("FAIL: exactly one V17 night gate required")
    namespace = {}
    exec(compile(ast.Module(body=funcs, type_ignores=[]), str(SOURCE), "exec"), namespace)
    gate = namespace["night_lamp_shape_gate"]
    failures = []
    for name, bbox, area, changed, streak, displacement, fill, expected in CASES:
        actual = bool(gate(bbox, area, changed, streak, displacement, fill))
        if actual != expected:
            failures.append({"name": name, "expected": expected, "actual": actual})
    print(json.dumps({
        "source": str(SOURCE), "cases": len(CASES),
        "passed": len(CASES) - len(failures), "failed": failures,
        "hardware_motion_test_performed": False,
    }))
    if failures:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
