#!/usr/bin/env python3
from pathlib import Path

p=Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
s=p.read_text(encoding="utf-8",errors="replace")

def section(name,next_names):
    try:
        a=s.index("def "+name)
    except ValueError:
        print("MISSING",name); return
    b=len(s)
    for n in next_names:
        i=s.find("\ndef "+n,a+4)
        if i!=-1: b=min(b,i)
    print("=== "+name+" ===")
    print(s[a:b][:12000])

section("hts_bluetooth_mode_fast()",["ensure_hts_power","bluetooth_menu_sequence","run_sequence","ports"])
section("bluetooth_menu_sequence()",["run_sequence","ports","receiver_present"])
section("run_sequence(seq)",["ports","receiver_present","ensure_tv_power"])
print("=== ROUTES ===")
for i,line in enumerate(s.splitlines(),1):
    if "bluetooth-mode-fast" in line or "bluetooth-menu" in line or "/ht-e6500/source" in line:
        print(i,line)
print("RESULT=HTS_MODE_V877_INSPECTED")
