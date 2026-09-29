#!/usr/bin/env python3
from pathlib import Path
import subprocess

def run(cmd):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=15)
    print("$ "+" ".join(cmd))
    print((p.stdout or "")[-12000:])

run(["adb","-s","993e96d0","shell","pm","list","features"])
run(["adb","-s","993e96d0","shell","dumpsys","consumer_ir"])
p=Path("/home/jespern/s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java")
s=p.read_text(encoding="utf-8",errors="replace")
for term in ("onReceive","ConsumerIrManager","transmit","hasIrEmitter","CODES.get"):
    print("===",term,"===")
    for i,line in enumerate(s.splitlines(),1):
        if term in line:
            a=max(1,i-12); b=min(len(s.splitlines()),i+24)
            for j in range(a,b+1):
                print(f"{j}:{s.splitlines()[j-1]}")
            break
print("RESULT=V877_S5_IR_RUNTIME_INSPECTED")
