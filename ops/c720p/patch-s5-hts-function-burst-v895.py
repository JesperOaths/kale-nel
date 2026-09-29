#!/usr/bin/env python3
from pathlib import Path
import subprocess, shutil, time, hashlib, os

HOME=Path("/home/jespern")
BUILD=HOME/"build_install_s5_ir_bridge.sh"
SRC=HOME/"s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-hts-function-burst-v895-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
SER="993e96d0"
PKG="com.bruis.s5irbridge"

for p in (BUILD,SRC):
    if p.exists():
        shutil.copy2(p,BACK/(p.name+".before"))

# Preserve the actually installed APK for exact rollback.
pm=subprocess.run(["adb","-s",SER,"shell","pm","path",PKG],text=True,capture_output=True,timeout=12)
remote=""
for line in (pm.stdout or "").splitlines():
    if line.startswith("package:"):
        remote=line.split("package:",1)[1].strip()
        break
apk_before=BACK/"s5-ir-live-before.apk"
if remote:
    subprocess.run(["adb","-s",SER,"pull",remote,str(apk_before)],check=True,timeout=40)

old='if ("power".equals(command) && code.pattern.length == 204) {'
new='if (("power".equals(command) || "function".equals(command)) && code.pattern.length == 204) {'

def patch(p):
    if not p.exists():
        return False
    s=p.read_text(encoding="utf-8")
    if new in s:
        return False
    if old not in s:
        raise SystemExit("204-frame split anchor missing in "+str(p))
    s=s.replace(old,new,1)
    s=s.replace("HT-E6500 Power from the verified Samsung HT profile contains",
                "HT-E6500 Power/FUNCTION from the verified Samsung HT profile contain",1)
    p.write_text(s,encoding="utf-8")
    return True

changed_build=patch(BUILD)
changed_src=patch(SRC)

env=dict(os.environ)
env["S5_TARGET"]=SER
p=subprocess.run([str(BUILD)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
print((p.stdout or "")[-14000:])
if p.returncode!=0:
    if apk_before.exists():
        subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit(p.returncode)

built=HOME/"s5-ir-bridge-manual/build/s5-ir-bridge.apk"
if not built.exists():
    if apk_before.exists():
        subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit("built APK missing")

print("BACKUP="+str(BACK))
print("BEFORE_APK_SHA="+(hashlib.sha256(apk_before.read_bytes()).hexdigest() if apk_before.exists() else "missing"))
print("NEW_APK_SHA="+hashlib.sha256(built.read_bytes()).hexdigest())
print("BUILD_PATCHED="+str(changed_build).lower())
print("SOURCE_PATCHED="+str(changed_src).lower())
print("RESULT=V895_FUNCTION_BURST_INSTALLED")
