#!/usr/bin/env python3
from pathlib import Path
import subprocess, shutil, time, re, hashlib, json

HOME=Path("/home/jespern")
BUILD=HOME/"build_install_s5_ir_bridge.sh"
GEN=HOME/"patch_s5_ir_bridge_final_verified_remote.py"
BASE=HOME/"c720p-home-hub"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-hts-power-burst-v877-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
SER="993e96d0"
PKG="com.bruis.s5irbridge"

for p in (BUILD,GEN):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

# Preserve the currently installed APK for exact rollback.
pm=subprocess.run(["adb","-s",SER,"shell","pm","path",PKG],text=True,capture_output=True,timeout=12)
remote=""
for line in (pm.stdout or "").splitlines():
    if line.startswith("package:"):
        remote=line.split("package:",1)[1].strip(); break
apk_before=BACK/"s5-ir-live-before.apk"
if remote:
    subprocess.run(["adb","-s",SER,"pull",remote,str(apk_before)],check=True,timeout=40)

old='''        try {
            ir.transmit(code.frequency, code.pattern);
            Log.i(TAG, "Sent verified command=" + command + " freq=" + code.frequency + " len=" + code.pattern.length + " repeats=1_call");
        } catch (Throwable t) {'''
new='''        try {
            int calls = 1;
            // HT-E6500 Power from the verified Samsung HT profile contains
            // three 68-element frames. ConsumerIrManager is more reliable on
            // this Galaxy S5 when each frame is submitted separately instead
            // of one 204-element call.
            if ("power".equals(command) && code.pattern.length == 204) {
                final int frameLen = 68;
                calls = 3;
                for (int frame = 0; frame < calls; frame++) {
                    int[] one = new int[frameLen];
                    System.arraycopy(code.pattern, frame * frameLen, one, 0, frameLen);
                    ir.transmit(code.frequency, one);
                    if (frame + 1 < calls) {
                        try { Thread.sleep(8); } catch (InterruptedException ignored) {}
                    }
                }
            } else {
                ir.transmit(code.frequency, code.pattern);
            }
            Log.i(TAG, "Sent verified command=" + command + " freq=" + code.frequency + " len=" + code.pattern.length + " calls=" + calls);
        } catch (Throwable t) {'''

def patch_file(p: Path):
    s=p.read_text(encoding="utf-8")
    if new in s:
        return False
    if old not in s:
        raise SystemExit(f"transmit block not found in {p}")
    p.write_text(s.replace(old,new,1),encoding="utf-8")
    return True

changed_build=patch_file(BUILD)
changed_gen=patch_file(GEN) if GEN.exists() else False

# Build/install over the stable USB serial, not a stale Wi-Fi address.
env=dict(__import__("os").environ)
env["S5_TARGET"]=SER
p=subprocess.run([str(BUILD)],env=env,text=True,capture_output=True,timeout=180)
print(p.stdout[-12000:])
if p.returncode != 0:
    print(p.stderr[-6000:])
    if apk_before.exists():
        subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit(p.returncode)

# Verify installed package and preserve the newly built APK hash.
built=HOME/"s5-ir-bridge-manual/build/s5-ir-bridge.apk"
if not built.exists():
    if apk_before.exists():
        subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit("built APK missing")
print("BACKUP="+str(BACK))
print("BEFORE_APK_SHA="+(hashlib.sha256(apk_before.read_bytes()).hexdigest() if apk_before.exists() else "missing"))
print("NEW_APK_SHA="+hashlib.sha256(built.read_bytes()).hexdigest())
print("BUILD_SCRIPT_PATCHED="+str(changed_build).lower())
print("GENERATOR_PATCHED="+str(changed_gen).lower())
print("RESULT=V877_S5_POWER_BURST_INSTALLED")
