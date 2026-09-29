#!/usr/bin/env python3
from pathlib import Path
import subprocess, shutil, time, hashlib, os

HOME=Path("/home/jespern")
BUILD=HOME/"build_install_s5_ir_bridge.sh"
SRC=HOME/"s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"s5-merge-grundig-v899-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
SER="993e96d0"; PKG="com.bruis.s5irbridge"

for p in (BUILD,SRC):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

pm=subprocess.run(["adb","-s",SER,"shell","pm","path",PKG],text=True,capture_output=True,timeout=12)
remote=""
for line in (pm.stdout or "").splitlines():
    if line.startswith("package:"): remote=line.split("package:",1)[1].strip(); break
apk_before=BACK/"s5-ir-live-before.apk"
if remote:
    subprocess.run(["adb","-s",SER,"pull",remote,str(apk_before)],check=True,timeout=40)

defs='''        // Restored from preserved working Grundig 49 GUS 8960 S5 bridge APK (sha256 11243927...).
        putNec("grundig_power", 0x2662BA45L);
        putNec("grundig_source", 0x00FF45BAL);
        putNec("grundig_up", 0x26629B64L);
        putNec("grundig_down", 0x266223DCL);
        putNec("grundig_left", 0x2662837CL);
        putNec("grundig_right", 0x2662C33CL);
        putNec("grundig_ok", 0x26621CE3L);
        putNec("grundig_back", 0x2662AB54L);
        putNec("grundig_exit", 0x266227D8L);
        putNec("grundig_volume_up", 0x00FF5AA5L);
        putNec("grundig_volume_down", 0x00FFDA25L);
        putNec("grundig_mute", 0x00FFB04FL);
        putNec("grundig_power_alt", 0x00FF30CFL);
        putNec("grundig_source_alt", 0x00FFA25DL);
        putNec("grundig_ok_alt", 0x00FF48B7L);
        putNec("grundig_down_alt", 0x00FF847BL);
'''

helpers='''    private static int[] nec(long payload) {
        int[] out = new int[201];
        int at = 0;
        for (int frame = 0; frame < 3; frame++) {
            out[at++] = 9000;
            out[at++] = 4500;
            for (int bit = 31; bit >= 0; bit--) {
                out[at++] = 560;
                out[at++] = ((payload & (1L << bit)) != 0) ? 1690 : 560;
            }
            out[at++] = (frame == 2) ? 42000 : 560;
        }
        return out;
    }

    private static void putNec(String name, long payload) {
        CODES.put(name, new Code(38000, nec(payload)));
    }

'''

def patch_text(s):
    if 'putNec("grundig_power", 0x2662BA45L);' not in s:
        anchor='    static {\n'
        if anchor not in s: raise SystemExit("static block anchor missing")
        s=s.replace(anchor,anchor+defs,1)
    if 'private static int[] nec(long payload)' not in s:
        anchor='    @Override\n    public void onReceive'
        if anchor not in s: raise SystemExit("onReceive anchor missing")
        s=s.replace(anchor,helpers+anchor,1)
    return s

BUILD.write_text(patch_text(BUILD.read_text(encoding="utf-8")),encoding="utf-8")
if SRC.exists():
    SRC.write_text(patch_text(SRC.read_text(encoding="utf-8")),encoding="utf-8")

env=dict(os.environ); env["S5_TARGET"]=SER
p=subprocess.run([str(BUILD)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
print((p.stdout or "")[-14000:])
if p.returncode!=0:
    if apk_before.exists(): subprocess.run(["adb","-s",SER,"install","-r",str(apk_before)],check=False,timeout=60)
    raise SystemExit(p.returncode)

built=HOME/"s5-ir-bridge-manual/build/s5-ir-bridge.apk"
print("BACKUP="+str(BACK))
print("BEFORE_APK_SHA="+(hashlib.sha256(apk_before.read_bytes()).hexdigest() if apk_before.exists() else "missing"))
print("NEW_APK_SHA="+hashlib.sha256(built.read_bytes()).hexdigest())
print("GRUNDIG_POWER_PRESENT="+str('putNec("grundig_power", 0x2662BA45L);' in SRC.read_text()).lower())
print("HTS_FUNCTION_PRESENT="+str('CODES.put("function"' in SRC.read_text()).lower())
print("RESULT=V899_GRUNDIG_MERGED")