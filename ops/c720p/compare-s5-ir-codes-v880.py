#!/usr/bin/env python3
from pathlib import Path
import re,hashlib

files={
 "current":Path("/home/jespern/s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java"),
 "backup_085227":Path("/home/jespern/c720p-backups/s5-ir-http-20260926-085227/src/com/bruis/s5irbridge/IrReceiver.java"),
 "backup_060944":Path("/home/jespern/c720p-backups/s5-ir-http-20260926-060944/src/com/bruis/s5irbridge/IrReceiver.java"),
 "backup_054745":Path("/home/jespern/c720p-backups/s5-ir-http-20260926-054745/src/com/bruis/s5irbridge/IrReceiver.java"),
}
cmds=("power","source_input","function","volume_up")
for name,p in files.items():
    print("===",name,p,"exists",p.exists(),"===")
    if not p.exists(): continue
    s=p.read_text(errors="replace")
    for cmd in cmds:
        m=re.search(r'CODES\.put\("'+re.escape(cmd)+r'"\s*,\s*new Code\((.*?)\)\);',s,re.S)
        if not m:
            print(cmd,"MISSING")
            continue
        raw=m.group(0)
        print(cmd,"sha256",hashlib.sha256(raw.encode()).hexdigest(),"len",len(raw))
        print(raw[:240].replace("\n"," "))
print("RESULT=V880_S5_IR_CODES_COMPARED")
