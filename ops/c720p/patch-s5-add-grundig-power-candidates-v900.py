#!/usr/bin/env python3
from pathlib import Path
import subprocess, shutil, time, hashlib, os

HOME=Path("/home/jespern")
BUILD=HOME/"build_install_s5_ir_bridge.sh"
SRC=HOME/"s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-grundig-power-candidates-v900-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
SER="993e96d0"; PKG="com.bruis.s5irbridge"

for p in (BUILD,SRC):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

pm=subprocess.run(["adb","-s",SER,"shell","pm","path",PKG],text=True,capture_output=True,timeout=12)
remote=""
for line in (pm.stdout or "").splitlines():
    if line.startswith("package:"): remote=line.split("package:",1)[1].strip(); break
apk_before=BACK/"s5-ir-live-before.apk"
if remote: subprocess.run(["adb","-s",SER,"pull",remote,str(apk_before)],check=True,timeout=40)

extra='''        putNec("grundig_power_a", 0x2662BA45L);
        putNec("grundig_power_b", 0x2662F00FL);
        putNec("grundig_power_c", 0x00FF02FDL);
        putNec("grundig_power_d", 0x00FF12EDL);
        putNec("grundig_power_e", 0x20DF10EFL);
        putNec("grundig_power_f", 0xE0E040BFL);
        putNec("grundig_power_g", 0x04FB08F7L);
        putNec("grundig_power_h", 0x807F02FDL);
'''

def patch_text(s):
    if 'putNec("grundig_power_b", 0x2662F00FL);' in s: return s
    anchor='        putNec("grundig_power_alt", 0x00FF30CFL);\n'
    if anchor not in s: raise SystemExit("Grundig merge anchor missing")
    return s.replace(anchor,anchor+extra,1)

BUILD.write_text(patch_text(BUILD.read_text(encoding="utf-8")),encoding="utf-8")
if SRC.exists(): SRC.write_text(patch_text(SRC.read_text(encoding="utf-8")),encoding="utf-8")

env=dict(os.environ); env["S5_TARGET"]=SER
p=subprocess.run([str(BUILD)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
print((p.stdout or "")[-12000:])
if p.returncode!=0:
    if apk_before.exists(): subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit(p.returncode)
built=HOME/"s5-ir-bridge-manual/build/s5-ir-bridge.apk"
print("BACKUP="+str(BACK))
print("BEFORE_APK_SHA="+(hashlib.sha256(apk_before.read_bytes()).hexdigest() if apk_before.exists() else "missing"))
print("NEW_APK_SHA="+hashlib.sha256(built.read_bytes()).hexdigest())
print("CANDIDATES_PRESENT="+str('grundig_power_h' in SRC.read_text()).lower())
print("RESULT=V900_GRUNDIG_CANDIDATES_INSTALLED")