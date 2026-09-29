#!/usr/bin/env python3
import json, subprocess, time, urllib.request, urllib.error\nfrom pathlib import Path

SER="993e96d0"
COMP="com.bruis.s5irbridge/.IrReceiver"
ACT="com.bruis.s5irbridge.SEND"
TV="http://127.0.0.1:8789/grundig-tv/power-state"

def sh(args,timeout=12):
    t=time.monotonic()
    try:
        p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return {"ok":p.returncode==0,"rc":p.returncode,"elapsed_s":round(time.monotonic()-t,3),"out":(p.stdout or "")[-3000:]}
    except Exception as e:
        return {"ok":False,"elapsed_s":round(time.monotonic()-t,3),"error":repr(e)}

def tv():
    try:
        with urllib.request.urlopen(TV,timeout=5) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"ok":False,"error":repr(e),"state":"unknown"}

def send(cmd):
    return sh(["adb","-s",SER,"shell","am","broadcast","-n",COMP,"-a",ACT,
               "--es","device","grundig_tv","--es","command",cmd],8)

def wait_on(seconds=18):
    hist=[]
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        st=tv(); hist.append(st)
        if str(st.get("state","")).lower()=="on":
            return True,hist
        time.sleep(1)
    return False,hist

out={"initial":tv()}
if str(out["initial"].get("state","")).lower()!="off":
    out["result"]="TV_NOT_CONFIRMED_OFF_NO_IR_SENT"
else:
    tx=send("grundig_power")
    out["primary_tx"]=tx
    hit,hist=wait_on(20)
    out["primary_wake"]=hit
    out["primary_polls"]=hist
    out["result"]="PRIMARY_GRUNDIG_POWER_WAKES_TV" if hit else "PRIMARY_GRUNDIG_POWER_DID_NOT_WAKE"
out["final"]=tv()
print(json.dumps(out,indent=2,sort_keys=True))
print("RESULT="+out["result"])
