#!/usr/bin/env python3
import subprocess, pathlib, re, os, json, time, glob

SER="993e96d0"; PKG="com.bruis.s5irbridge"
def run(cmd,timeout=20,limit=18000):
    try:
        p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e: return "ERR="+repr(e)

out=[]
out.append("=== ADB_DEVICES ===\n"+run(["adb","devices","-l"],8))
out.append("=== PACKAGE ===\n"+run(["adb","-s",SER,"shell","dumpsys","package",PKG],12,22000))
out.append("=== PM_PATH ===\n"+run(["adb","-s",SER,"shell","pm","path",PKG],8))
out.append("=== IR_SERVICE ===\n"+run(["adb","-s",SER,"shell","sh","-c","service list | grep -i -E 'consumer|infrared|ir' || true; dumpsys consumer_ir 2>&1 || true"],10,9000))
out.append("=== FEATURES ===\n"+run(["adb","-s",SER,"shell","sh","-c","pm list features | grep -i -E 'consumer|infrared|ir' || true"],8,5000))
out.append("=== RUN_AS ===\n"+run(["adb","-s",SER,"shell","run-as",PKG,"sh","-c","find . -maxdepth 3 -type f -print 2>/dev/null | head -100"],8,7000))
out.append("=== APP_PROCESSES ===\n"+run(["adb","-s",SER,"shell","ps"],8,6000))

# Pull installed APK and inspect DEX string table for command names and IR APIs.
pm=subprocess.run(["adb","-s",SER,"shell","pm","path",PKG],text=True,capture_output=True,timeout=8)
m=re.search(r"package:(\S+)",pm.stdout or "")
if m:
    remote=m.group(1); local="/tmp/s5irbridge-v875.apk"
    out.append("=== APK_PULL ===\n"+run(["adb","-s",SER,"pull",remote,local],20,4000))
    if pathlib.Path(local).exists():
        out.append("=== APK_LIST ===\n"+run(["unzip","-l",local],8,7000))
        subprocess.run(["bash","-lc",f"rm -rf /tmp/s5dex-v875; mkdir -p /tmp/s5dex-v875; cd /tmp/s5dex-v875 && unzip -o {local} 'classes*.dex' >/dev/null"],timeout=8)
        out.append("=== DEX_STRINGS ===\n"+run(["bash","-lc","strings /tmp/s5dex-v875/classes*.dex 2>/dev/null | grep -iE 'ht_e6500|power|function|dvd|volume|menu_6c|ConsumerIr|transmit|pattern|frequency|SEND|IrReceiver' | head -400"],10,16000))

# Capture app/runtime reaction to a harmless MUTE command (self-reversing with second press).
subprocess.run(["adb","-s",SER,"logcat","-c"],timeout=8)
for n in (1,2):
    out.append(f"=== MUTE_BROADCAST_{n} ===\n"+run(["adb","-s",SER,"shell","am","broadcast","-n",PKG+"/.IrReceiver","-a",PKG+".SEND","--es","device","ht_e6500","--es","command","mute"],8,5000))
    time.sleep(.8)
out.append("=== LOGCAT_AFTER_MUTE ===\n"+run(["adb","-s",SER,"logcat","-d","-v","time"],12,18000))

# Find evidence of previously successful Bluetooth connection / older bridge copies.
out.append("=== SUCCESS_HISTORY ===\n"+run(["bash","-lc","grep -RIl --exclude='*.mp4' --exclude='*.jpg' --exclude='*.png' -E 'bluetooth_connected.{0,30}true|RESULT=HTS_BLUETOOTH_CONFIRMED|SamsungHTS-8B063B' /home/jespern/c720p-home-hub/logs /home/jespern/c720p-backups 2>/dev/null | tail -80"],20,12000))
out.append("=== S5_BACKUPS ===\n"+run(["bash","-lc","find /home/jespern /tmp -maxdepth 5 -type f \( -iname '*s5*ir*' -o -iname '*irbridge*' -o -iname '*.apk' \) -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -120"],15,14000))
print("\n".join(out))
