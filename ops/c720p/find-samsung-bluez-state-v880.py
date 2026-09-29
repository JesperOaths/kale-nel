#!/usr/bin/env python3
import subprocess, pathlib

cmds=[
 "sudo -n find /var/lib/bluetooth -maxdepth 4 -type f -o -type d 2>/dev/null | grep -i '8C.C8.CD.8B.06.3B' | head -100",
 "find /home/jespern/c720p-backups /home/jespern/c720p-home-hub -type f 2>/dev/null | grep -Ei 'bluetooth|bluez|samsung' | head -300",
 "grep -RIl --binary-files=without-match '8C:C8:CD:8B:06:3B' /home/jespern/c720p-backups /home/jespern/c720p-home-hub 2>/dev/null | head -300",
]
for c in cmds:
    print("=== CMD ===",c)
    p=subprocess.run(["bash","-lc",c],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
    print((p.stdout or "")[-30000:])
print("RESULT=V880_BLUEZ_STATE_SEARCHED")
