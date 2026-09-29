#!/usr/bin/env python3
import json, subprocess, time, pathlib, shutil, tempfile, urllib.request

SER="993e96d0"
MAC="8C:C8:CD:8B:06:3B"
COMP="com.bruis.s5irbridge/.IrReceiver"
ACT="com.bruis.s5irbridge.SEND"
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
OLD=BASE/"tmp/s5-ir-parity/installed-current.apk"
BACK=pathlib.Path("/tmp/v926-current-before.apk")

def run(args,timeout=30):
    try:
        p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return {"ok":p.returncode==0,"rc":p.returncode,"out":(p.stdout or "")[-7000:]}
    except Exception as e:
        return {"ok":False,"error":repr(e)}

def install(apk):
    r=run(["adb","-s",SER,"install","-r",str(apk)],90)
    return r

def ir(cmd,device="ht_e6500"):
    return run(["adb","-s",SER,"shell","am","broadcast","-n",COMP,"-a",ACT,
                "--es","device",device,"--es","command",cmd],8)

def visible():
    d=run(["bluetoothctl","devices"],5)
    info=run(["bluetoothctl","info",MAC],5)
    txt=(d.get("out","")+"\n"+info.get("out","")).lower()
    return ("samsunghts" in txt or MAC.lower() in txt) and "not available" not in txt, {"devices":d,"info":info}

def sweep(cycles=8):
    trace=[]
    scan=subprocess.Popen(["timeout","45","bluetoothctl","scan","bredr"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        for n in range(cycles+1):
            vis,ev=visible(); trace.append({"cycle":n,"visible":vis})
            if vis: return True,n,trace
            if n==cycles: break
            tx=ir("function"); trace.append({"cycle":n+1,"function_ok":tx.get("ok"),"function":tx})
            for j in range(8):
                time.sleep(.35)
                vis,_=visible()
                if vis:
                    trace.append({"cycle":n+1,"probe":j+1,"visible":True})
                    return True,n+1,trace
    finally:
        try: scan.terminate()
        except Exception: pass
        run(["bash","-lc","timeout 2 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
    return False,None,trace

# Back up the currently installed bridge.
pm=run(["adb","-s",SER,"shell","pm","path","com.bruis.s5irbridge"],12)
remote=""
for line in pm.get("out","").splitlines():
    if line.startswith("package:"): remote=line.split("package:",1)[1].strip(); break
if remote:
    run(["adb","-s",SER,"pull",remote,str(BACK)],30)

out={"old_exists":OLD.exists(),"current_backup":BACK.exists()}
if not OLD.exists(): raise SystemExit("OLD_APK_MISSING")
out["install_old"]=install(OLD)
if not out["install_old"].get("ok"): raise SystemExit("OLD_APK_INSTALL_FAILED")
time.sleep(1)

# Also test old APK's Grundig code once from confirmed-off TV.
try:
    with urllib.request.urlopen("http://127.0.0.1:8789/grundig-tv/power-state",timeout=5) as r:
        tv0=json.loads(r.read().decode())
except Exception as e:
    tv0={"state":"unknown","error":repr(e)}
out["tv_before"]=tv0
if str(tv0.get("state","")).lower()=="off":
    out["old_grundig_power_tx"]=ir("grundig_power","grundig_tv")
    polls=[]
    for _ in range(10):
        time.sleep(1)
        try:
            with urllib.request.urlopen("http://127.0.0.1:8789/grundig-tv/power-state",timeout=5) as r:
                st=json.loads(r.read().decode())
        except Exception as e: st={"state":"unknown","error":repr(e)}
        polls.append(st)
        if str(st.get("state","")).lower()=="on": break
    out["old_grundig_power_polls"]=polls
    out["old_grundig_woke_tv"]=any(str(x.get("state","")).lower()=="on" for x in polls)

hit,cycle,trace=sweep(8)
out["prepower"]={"hit":hit,"cycle":cycle,"trace":trace}
power_sent=False
if not hit:
    out["power_tx"]=ir("power")
    power_sent=True
    time.sleep(5)
    hit,cycle,trace=sweep(8)
    out["postpower"]={"hit":hit,"cycle":cycle,"trace":trace}
out["visible"]=hit
out["power_sent"]=power_sent
out["cycle"]=cycle

if hit:
    out["connector"]=run([str(BASE/"bin/c720p-samsung-bluetooth-connect.sh")],90)
    try: out["bt_state"]=json.loads((BASE/"samsung-bluetooth-state.json").read_text())
    except Exception as e: out["bt_state"]={"error":repr(e)}
else:
    out["bt_state"]={}
st=out["bt_state"]
out["success"]=bool(st.get("bluetooth_connected") and st.get("audio_sink_present") and st.get("audio_sink_default"))

# Keep exact old APK only if it actually restores verified Samsung audio;
# otherwise restore the newer current bridge.
if not out["success"] and BACK.exists():
    out["restore_current"]=install(BACK)
else:
    out["kept_old_apk"]=bool(out["success"])

out["result"]="OLD_APK_CONNECTED_VERIFIED" if out["success"] else "OLD_APK_STATE_SAFE_FAILED"
print(json.dumps(out,indent=2,sort_keys=True))
print("RESULT="+out["result"])
