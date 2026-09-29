#!/usr/bin/env python3
import json, re, subprocess
SER="993e96d0"

def run(args,timeout=20):
    p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return p.returncode,p.stdout or ""

rc,out=run(["adb","-s",SER,"shell","pm","list","packages","-f"],25)
pkgs=[]
rx=re.compile(r'(watchon|peel|remote|ir|tv|lean)',re.I)
for line in out.splitlines():
    if not line.startswith("package:"): continue
    pkg=line.rsplit("=",1)[-1].strip() if "=" in line else line.split(":",1)[1].strip()
    if rx.search(pkg) or rx.search(line):
        pkgs.append(pkg)

details=[]
for pkg in sorted(set(pkgs)):
    rc,d=run(["adb","-s",SER,"shell","dumpsys","package",pkg],20)
    main=[]
    for line in d.splitlines():
        if "MAIN" in line or "LAUNCHER" in line or "versionName=" in line or "firstInstallTime=" in line or "lastUpdateTime=" in line or "TRANSMIT_IR" in line:
            main.append(line.strip())
    rc2,res=run(["adb","-s",SER,"shell","cmd","package","resolve-activity","--brief",pkg],8)
    details.append({"package":pkg,"resolve":res.strip(),"signals":main[:120]})

print(json.dumps({"packages":details},indent=2,sort_keys=True))
print("RESULT=V927_S5_REMOTE_INVENTORY_DONE")
