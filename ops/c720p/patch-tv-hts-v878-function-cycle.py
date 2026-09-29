#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v878-function-cycle-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(HELPER,BACK/"c720p-bluetooth-helper-server.py.before")

s=HELPER.read_text(encoding="utf-8")
n=s.count("post_json('/ht-e6500/source', timeout=5)")
if n < 1:
    raise SystemExit("expected current /ht-e6500/source cycle not found")
s=s.replace("post_json('/ht-e6500/source', timeout=5)",
            "post_json('/ht-e6500/function-fast', timeout=5)")
s=s.replace("'phase':'source_input'","'phase':'function'")
s=s.replace("'action':'prepower_source_input_cycle'","'action':'prepower_function_cycle'")
s=s.replace("'action':'deterministic_source_input_to_bt'","'action':'deterministic_function_to_bt'")
s=s.replace("'action':'adaptive_source_input_until_bt_ready'","'action':'adaptive_function_until_bt_ready'")
s=s.replace("f'connect_after_source_input_{cycle}'","f'connect_after_function_{cycle}'")
HELPER.write_text(s,encoding="utf-8")
subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("REPLACED_FUNCTION_CYCLES="+str(n))
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V878_FUNCTION_CYCLE_RESTORED")
