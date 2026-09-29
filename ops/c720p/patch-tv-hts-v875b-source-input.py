#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v875b-source-input-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(HELPER,BACK/"c720p-bluetooth-helper-server.py.before")

s=HELPER.read_text(encoding="utf-8")
old_count=s.count("post_json('/ht-e6500/function-fast', timeout=5)")
if old_count < 1:
    raise SystemExit("expected function-fast source-cycle calls not found")
s=s.replace("post_json('/ht-e6500/function-fast', timeout=5)",
            "post_json('/ht-e6500/source', timeout=5)")
# Keep diagnostics truthful.
s=s.replace("'phase':'function'","'phase':'source_input'")
s=s.replace("'action':'deterministic_function_to_bt'","'action':'deterministic_source_input_to_bt'")
s=s.replace("'action':'prepower_function_cycle'","'action':'prepower_source_input_cycle'")
s=s.replace("'action':'adaptive_function_until_bt_ready'","'action':'adaptive_source_input_until_bt_ready'")
s=s.replace("f'connect_after_function_{cycle}'","f'connect_after_source_input_{cycle}'")
HELPER.write_text(s,encoding="utf-8")
subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("REPLACED_SOURCE_CYCLES="+str(old_count))
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V875B_SOURCE_INPUT_RESTORED")
