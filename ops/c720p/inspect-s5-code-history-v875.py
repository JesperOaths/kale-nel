#!/usr/bin/env python3
import subprocess,pathlib,hashlib,glob,re,os

def sh(cmd,timeout=25,limit=30000):
    try:
        p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e:return "ERR="+repr(e)

print("=== CURRENT_SOURCE_CODEMAP ===")
for p in [
 "/home/jespern/s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java",
 "/home/jespern/build_install_s5_ir_bridge.sh",
 "/home/jespern/patch_s5_ir_bridge_final_verified_remote.py",
]:
 q=pathlib.Path(p)
 if q.exists():
  print("---",p,"---")
  txt=q.read_text(errors="ignore")
  for line in txt.splitlines():
   if re.search(r'power|function|dvd|mute|CODES\.put|new Code|repeat|transmit',line,re.I):
    print(line[:1600])

print("=== FUNCTION_FIX_DIR ===")
print(sh("find /home/jespern/c720p-backups/s5-ir-function-fix-20260926-210547 -maxdepth 3 -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null | sort",10,12000))
print("=== APK_INVENTORY_26SEP ===")
print(sh("find /home/jespern/c720p-backups /home/jespern/c720p-home-hub/tmp /home/jespern/s5-ir-bridge-manual/build -type f -iname '*.apk' -newermt '2026-09-26 00:00' ! -newermt '2026-09-27 00:00' -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null | sort",15,18000))
print("=== SCRIPT_TIMELINE_26SEP ===")
print(sh("find /home/jespern -maxdepth 3 -type f \( -iname '*s5*ir*' -o -iname '*ht*bluetooth*' -o -iname '*surround*' \) -newermt '2026-09-26 00:00' ! -newermt '2026-09-27 00:00' -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null | sort",20,18000))
print("=== S5IR_LOGCAT_HISTORY ===")
print(sh("adb -s 993e96d0 logcat -d -v time | grep -F 'S5IRBridge' | tail -160",15,18000))
print("=== CURRENT_POWER_FUNCTION_KERNEL_HINTS ===")
print(sh("adb -s 993e96d0 shell dmesg 2>/dev/null | grep -E 'ir_send|Sending IR|emission_time|buf_size' | tail -100",12,12000))
