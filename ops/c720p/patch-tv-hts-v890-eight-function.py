#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
CONN=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v890-eight-function-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,CONN):
    shutil.copy2(p,BACK/(p.name+".before"))

s=HELPER.read_text(encoding="utf-8")
old="post_json('/ht-e6500/source', timeout=5)"
new="post_json('/ht-e6500/function-fast', timeout=5)"
if old not in s and new not in s:
    raise SystemExit("helper source-cycle call not found")
if old in s:
    s=s.replace(old,new)
s=s.replace("'phase':'source_input'","'phase':'function'")
s=s.replace("'action':'prepower_source_input_cycle'","'action':'prepower_function_cycle'")
s=s.replace("'action':'deterministic_source_input_to_bt'","'action':'deterministic_function_to_bt'")
s=s.replace("'action':'adaptive_source_input_until_bt_ready'","'action':'adaptive_function_until_bt_ready'")
s=s.replace("f'connect_after_source_input_{cycle}'","f'connect_after_function_{cycle}'")
HELPER.write_text(s,encoding="utf-8")

c=CONN.read_text(encoding="utf-8")
if "--es command source_input" in c:
    c=c.replace("--es command source_input","--es command function")
elif "--es command function" not in c:
    raise SystemExit("connector source command not found")
c=c.replace("source-input press","FUNCTION press")
c=c.replace("source-cycle","function-cycle")
CONN.write_text(c,encoding="utf-8")
CONN.chmod(0o755)

subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["bash","-n",str(CONN)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)

print("BACKUP="+str(BACK))
print("HELPER_FUNCTION_FAST="+str("post_json('/ht-e6500/function-fast', timeout=5)" in HELPER.read_text()).lower())
print("CONNECTOR_FUNCTION="+str("--es command function" in CONN.read_text()).lower())
print("CONNECTOR_SOURCE_CYCLES_8="+str("SOURCE_CYCLES=8" in CONN.read_text()).lower())
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V890_EIGHT_FUNCTION_PATCHED")
