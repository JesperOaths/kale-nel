#!/usr/bin/env python3
import shutil, subprocess, pathlib
print("OPENCLAW_BIN="+str(shutil.which("openclaw") or ""))
print("NODE_BIN="+str(shutil.which("node") or ""))
print("NPM_BIN="+str(shutil.which("npm") or ""))
for cmd,label in [
 (["systemctl","--user","list-unit-files","--no-pager"],"UNITS"),
 (["ps","-eo","pid,comm,args"],"PROCS")
]:
    try:
        p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=15,check=False)
        lines=[x for x in p.stdout.splitlines() if "openclaw" in x.lower()]
        print(label+"="+repr(lines[:30]))
    except Exception as e:
        print(label+"_ERR="+type(e).__name__)
print("BACKUP_DIR_EXISTS="+str(pathlib.Path("/home/jespern/openclaw-backups").exists()).lower())
print("RESULT=OPENCLAW_RUNTIME_DIAG_V868_DONE")
