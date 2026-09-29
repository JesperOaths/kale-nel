#!/usr/bin/env python3
import pathlib,json,glob,subprocess,re,os
B=pathlib.Path("/home/jespern/c720p-home-hub")
def sh(cmd,timeout=25,limit=28000):
    try:
        p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return f"RC={p.returncode}\n"+(p.stdout or "")[-limit:]
    except Exception as e:return "ERR="+repr(e)

f=B/"logs/tv-hts-bluetooth-pipeline-20260926-170850.json"
d=json.loads(f.read_text())
print("=== SUCCESS_170850_STEPS ===")
for i,s in enumerate(d.get("steps") or []):
    if 7 <= i <= 27:
        print("STEP",i)
        print(json.dumps(s,indent=2)[:14000])

print("=== ADAPTIVE_IMPLEMENTATIONS ===")
print(sh("grep -Rnl --include='*.py' 'adaptive_hts_source_cycle' /home/jespern/c720p-home-hub /home/jespern/c720p-backups 2>/dev/null | head -100",20,14000))
paths=subprocess.run(["bash","-lc","grep -Rnl --include='*.py' 'adaptive_hts_source_cycle' /home/jespern/c720p-home-hub /home/jespern/c720p-backups 2>/dev/null | head -30"],text=True,capture_output=True,timeout=20).stdout.splitlines()
for p in paths:
    print("###",p)
    print(sh(f"grep -n -A 18 -B 18 'adaptive_hts_source_cycle' {p} | head -120",8,14000))

print("=== HELPER_BACKUPS_TIMELINE ===")
print(sh("find /home/jespern/c720p-home-hub /home/jespern/c720p-backups -type f -name '*c720p-bluetooth-helper-server.py*' -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' 2>/dev/null | sort | tail -120",20,20000))

print("=== FUNCTION_CODE_CURRENT ===")
src=pathlib.Path("/home/jespern/s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java")
if src.exists():
 for line in src.read_text(errors="ignore").splitlines():
  if 'CODES.put("function"' in line or 'CODES.put("power"' in line or 'CODES.put("dvd"' in line:
   print(line)

print("=== FUNCTION_BUILD_REFERENCES ===")
print(sh("grep -Rni --include='*.py' --include='*.sh' --include='*.java' -E 'CODES.put.?.function|command.?=.?.function|function.*new Code|final remote command' /home/jespern 2>/dev/null | tail -220",30,26000))
