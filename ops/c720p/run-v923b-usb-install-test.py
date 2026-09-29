#!/usr/bin/env python3
import json, pathlib, subprocess, time, urllib.request

SER="993e96d0"
APK=pathlib.Path("/home/jespern/s5-ir-bridge-manual/build/s5-ir-bridge.apk")
TV="http://127.0.0.1:8789/grundig-tv/power-state"
COMP="com.bruis.s5irbridge/.IrReceiver"
ACT="com.bruis.s5irbridge.SEND"
CANDS=["lean_grundig_tv1_power","lean_grundig_tv3_power","lean_grundig_tv4_power","lean_grundig_tv5_power"]

def sh(args,timeout=40):
    p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return p.returncode,p.stdout or ""

if not APK.exists():
    raise SystemExit("BUILT_APK_MISSING")
rc,out=sh(["adb","-s",SER,"install","-r",str(APK)],90)
if rc!=0:
    # Deterministic USB fallback bypassing adb incremental-install quirks.
    remote="/data/local/tmp/s5-ir-bridge-v923.apk"
    rc1,o1=sh(["adb","-s",SER,"push",str(APK),remote],60)
    rc2,o2=sh(["adb","-s",SER,"shell","pm","install","-r",remote],90)
    out=out+"\nPUSH="+o1+"\nPM_INSTALL="+o2
    rc=rc2
print("USB_INSTALL_RC="+str(rc))
print(out[-5000:])
if rc!=0: raise SystemExit("USB_INSTALL_FAILED")

def tv():
    try:
        with urllib.request.urlopen(TV,timeout=5) as r: return json.loads(r.read().decode())
    except Exception as e: return {"state":"unknown","error":repr(e)}

def send(cmd):
    rc,out=sh(["adb","-s",SER,"shell","am","broadcast","-n",COMP,"-a",ACT,
               "--es","device","grundig_tv","--es","command",cmd],8)
    return {"ok":rc==0,"rc":rc,"out":out[-1500:]}

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
    rc,log=sh(["adb","-s",SER,"logcat","-d","-v","time"],12)
    result["ir_log"]=[x for x in log.splitlines() if "S5IRBridge" in x][-50:]
except Exception as e:
    result["ir_log_error"]=repr(e)
print(json.dumps(result,indent=2,sort_keys=True))
print("RESULT="+result["result"])
if result.get("winner"): print("WORKING_GRUNDIG_PROFILE="+str(result["winner"]))
