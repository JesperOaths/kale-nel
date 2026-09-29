#!/usr/bin/env python3
from pathlib import Path
import difflib,glob,os

BASE=Path("/home/jespern/c720p-home-hub")
live_h=BASE/"bin/c720p-bluetooth-helper-server.py"
live_c=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
cands=[
 BASE/"bin/c720p-bluetooth-helper-server.py.backup-adaptive-bt-20260926-210153",
 BASE/"bin/c720p-bluetooth-helper-server.py.backup-deterministic-bt-20260926-190544",
 BASE/"bin/c720p-bluetooth-helper-server.py.before-adaptive-function-only-20260926-111417",
 BASE/"bin/c720p-bluetooth-helper-server.py.before-direct-bt-function-20260926-112000",
 BASE/"bin/c720p-samsung-bluetooth-connect.sh.backup-bluez-state-machine-20260926-193806",
 BASE/"bin/c720p-samsung-bluetooth-connect.sh.backup-bounded-bluez-20260926-194120",
 BASE/"bin/c720p-samsung-bluetooth-connect.sh.before-scan-pair-window-20260926-114501",
 BASE/"backups/verified-tv-hts-bluetooth-20260719-072821/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh",
]
for p in cands:
    print("\n===== CANDIDATE",p,"EXISTS",p.exists(),"=====")
    if not p.exists(): continue
    live=live_h if "helper" in p.name else live_c
    a=p.read_text(errors="replace").splitlines()
    b=live.read_text(errors="replace").splitlines()
    # print only bluetooth/source/pair/connect related lines with context and compact diff
    keys=("prepare_hts_bluetooth","quick_pair_connect","try_pair_connect","cycle_source",
          "function-fast","source_input","SOURCE_CYCLES","bluetoothctl","pair ","connect ","remove ","scan bredr")
    print("--- KEY LINES CANDIDATE ---")
    for i,line in enumerate(a,1):
        if any(k in line for k in keys):
            print(f"{i}:{line}")
    print("--- DIFF FILTERED ---")
    for line in difflib.unified_diff(a,b,fromfile=str(p),tofile=str(live),n=2):
        if any(k in line for k in keys) or line.startswith(("@@","---","+++")):
            print(line)
print("RESULT=V878_PROVEN_BT_COMPARE_DONE")
