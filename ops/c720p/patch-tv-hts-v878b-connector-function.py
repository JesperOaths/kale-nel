#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
P=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v878b-connector-function-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(P,BACK/P.name)

s=P.read_text(encoding="utf-8")
old="--es command source_input"
if old not in s:
    raise SystemExit("connector source_input command not found")
s=s.replace(old,"--es command function")
s=s.replace("source-input press","FUNCTION press")
s=s.replace("source-cycle","function-cycle")
P.write_text(s,encoding="utf-8")
P.chmod(0o755)
subprocess.run(["bash","-n",str(P)],check=True)
print("BACKUP="+str(BACK))
print("RESULT=V878B_CONNECTOR_FUNCTION_RESTORED")
