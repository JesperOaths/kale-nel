#!/usr/bin/env python3
import json, subprocess, time, urllib.request, pathlib

BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/main/ops/c720p"
PATCH="/tmp/patch-s5-lean-grundig-profiles-v923.py"
with urllib.request.urlopen(BASE+"/patch-s5-lean-grundig-profiles-v923.py",timeout=30) as r:
    pathlib.Path(PATCH).write_bytes(r.read())
subprocess.run(["python3",PATCH],check=True,timeout=200)

SER="993e96d0"
TV="http://127.0.0.1:8789/grundig-tv/power-state"
COMP="com.bruis.s5irbridge/.IrReceiver"
ACT="com.bruis.s5irbridge.SEND"
CANDS=["lean_grundig_tv1_power","lean_grundig_tv3_power","lean_grundig_tv4_power","lean_grundig_tv5_power"]

def tv():
    try:
        with urllib.request.urlopen(TV,timeout=5) as r: return json.loads(r.read().decode())
    except Exception as e: return {"state":"unknown","error":repr(e)}

def send(cmd):
    p=subprocess.run(["adb","-s",SER,"shell","am","broadcast","-n",COMP,"-a",ACT,
                      "--es","device","grundig_tv","--es","command",cmd],
                     text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=8)
    return {"ok":p.returncode==0,"rc":p.returncode,"out":(p.stdout or "")[-1500:]}

def wait_on(seconds=16):
    hist=[]
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        st=tv(); hist.append(st)
        if str(st.get("state","")).lower()=="on": return True,hist
        time.sleep(1)
    return False,hist

result={"initial":tv(),"trials":[]}
if str(result["initial"].get("state","")).lower()!="off":
    result["result"]="TV_NOT_CONFIRMED_OFF_NO_TEST"
else:
    subprocess.run(["adb","-s",SER,"logcat","-c"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    winner=None
    for cmd in CANDS:
        if str(tv().get("state","")).lower()=="on":
            winner="already_on"; break
        tx=send(cmd)
        hit,hist=wait_on(16)
        result["trials"].append({"command":cmd,"tx":tx,"wake":hit,"polls":hist})
        if hit:
            winner=cmd; break
    result["winner"]=winner
    result["result"]="WORKING_PROFILE_FOUND" if winner else "NO_LEAN_GRUNDIG_PROFILE_WOKE_TV"
result["final"]=tv()
try:
    p=subprocess.run(["adb","-s",SER,"logcat","-d","-v","time"],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
    result["ir_log"]=[x for x in p.stdout.splitlines() if "S5IRBridge" in x][-40:]
except Exception as e:
    result["ir_log_error"]=repr(e)
print(json.dumps(result,indent=2,sort_keys=True))
print("RESULT="+result["result"])
if result.get("winner"): print("WORKING_GRUNDIG_PROFILE="+str(result["winner"]))
