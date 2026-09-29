#!/usr/bin/env python3
import subprocess, urllib.request, pathlib

BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p"

def run(cmd, timeout=60):
    try:
        p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        print("$ "+" ".join(cmd))
        print(p.stdout or "")
        return p.returncode
    except Exception as e:
        print("ERR",repr(e))
        return 99

print("===CEC_CAPABILITY===")
run(["bash","-lc","command -v cec-client || true; ls -l /dev/cec* 2>/dev/null || true; find /sys/class/drm -maxdepth 3 -iname '*cec*' -o -name edid 2>/dev/null | head -80 || true"],20)

for name in ("probe-hts-wol-v876.py","test-hts-menu-bt-v877.py"):
    dst=pathlib.Path("/tmp")/name
    with urllib.request.urlopen(f"{BASE}/{name}",timeout=30) as r:
        dst.write_bytes(r.read())
    run(["python3",str(dst)],90)

print("===FINAL===")
run(["bash","-lc","bluetoothctl devices || true; bluetoothctl info 8C:C8:CD:8B:06:3B || true; ip neigh show | grep -i '30:14:4a:14:77:ac' || true"],15)
print("RESULT=V881_ALT_PATH_TEST_DONE")
