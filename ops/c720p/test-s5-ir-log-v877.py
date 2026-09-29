#!/usr/bin/env python3
import subprocess,time,urllib.request,json

SER="993e96d0"
def run(cmd,timeout=15):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return p.returncode,(p.stdout or "")

run(["adb","-s",SER,"logcat","-c"])
req=urllib.request.Request("http://127.0.0.1:8789/ht-e6500/volume/up",method="POST")
try:
    with urllib.request.urlopen(req,timeout=8) as r:
        print("HTTP",r.status,r.read().decode("utf-8","replace")[:4000])
except Exception as e:
    print("HTTP_ERR",repr(e))
time.sleep(1.2)
rc,out=run(["adb","-s",SER,"logcat","-d","-v","time","-s","S5IRBridge:I","*:S"],10)
print("LOGCAT_RC",rc)
print(out[-8000:])
print("RESULT=V877_S5_IR_LOG_CAPTURED")
