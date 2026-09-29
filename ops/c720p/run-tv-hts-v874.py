#!/usr/bin/env python3
from pathlib import Path
import subprocess, urllib.request, time

BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p"
PATCH=Path("/tmp/patch-tv-hts-coldstart-v874.py")
TEST=Path("/tmp/test-tv-hts-v874.py")

def fetch(name, target):
    with urllib.request.urlopen(f"{BASE}/{name}", timeout=30) as r:
        target.write_bytes(r.read())

fetch("patch-tv-hts-coldstart-v874.py", PATCH)
subprocess.run(["python3", str(PATCH)], check=True)
subprocess.run(["systemctl","--user","restart","ht-e6500-surround.service","c720p-bluetooth-helper.service"], check=True)
time.sleep(2)
fetch("test-tv-hts-v874.py", TEST)
subprocess.run(["python3", str(TEST)], check=True)
