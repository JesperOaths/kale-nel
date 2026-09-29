#!/usr/bin/env python3
import json, subprocess, time, pathlib, os

SER="993e96d0"
MAC="8C:C8:CD:8B:06:3B"
COMP="com.bruis.s5irbridge/.IrReceiver"
ACT="com.bruis.s5irbridge.SEND"
BASE=pathlib.Path("/home/jespern/c720p-home-hub")

def run(args,timeout=20):
    try:
        p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        return {"ok":p.returncode==0,"rc":p.returncode,"out":(p.stdout or "")[-5000:]}
    except Exception as e:
        return {"ok":False,"error":repr(e)}

def ir(cmd):
    return run(["adb","-s",SER,"shell","am","broadcast","-n",COMP,"-a",ACT,
                "--es","device","ht_e6500","--es","command",cmd],8)

def visible():
    d=run(["bluetoothctl","devices"],5)
    info=run(["bluetoothctl","info",MAC],5)
    txt=(d.get("out","")+"\n"+info.get("out","")).lower()
    return ("samsunghts" in txt or MAC.lower() in txt) and "not available" not in txt, {"devices":d,"info":info}

def sweep(label,cycles=8):
    trace=[]
    scan=subprocess.Popen(["timeout","45","bluetoothctl","scan","bredr"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        for n in range(cycles+1):
            vis,ev=visible()
            trace.append({"cycle":n,"visible":vis,"evidence":ev})
            if vis: return True,n,trace
            if n==cycles: break
            tx=ir("function")
            trace.append({"cycle":n+1,"function_tx":tx})
            # allow Samsung WAIT -> BT READY transition and probe repeatedly
            for j in range(8):
                time.sleep(.35)
                vis,ev=visible()
                if vis:
                    trace.append({"cycle":n+1,"probe":j+1,"visible":True,"evidence":ev})
                    return True,n+1,trace
    finally:
        try: scan.terminate()
        except Exception: pass
        run(["bash","-lc","timeout 2 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
    return False,None,trace

out={}
out["initial_visible"],out["initial_evidence"]=visible()

# Phase A: never touch power. If receiver is already on, locate BT by FUNCTION only.
hit,cycle,trace=sweep("existing_power",8)
out["prepower_sweep"]={"hit":hit,"cycle":cycle,"trace":trace}
power_sent=False

if not hit:
    # No BT advertisement anywhere in a complete source ring. Issue exactly one
    # power toggle, then wait for receiver boot before a fresh source sweep.
    out["power_tx"]=ir("power")
    power_sent=True
    time.sleep(5)
    hit,cycle,trace=sweep("after_single_power",8)
    out["postpower_sweep"]={"hit":hit,"cycle":cycle,"trace":trace}

out["visible"]=hit
out["visible_cycle"]=cycle
out["power_sent"]=power_sent
if hit:
    conn=run([str(BASE/"bin/c720p-samsung-bluetooth-connect.sh")],90)
    out["connector"]=conn
    sf=BASE/"samsung-bluetooth-state.json"
    try: out["bt_state"]=json.loads(sf.read_text())
    except Exception as e: out["bt_state"]={"error":repr(e)}
    st=out["bt_state"]
    out["success"]=bool(st.get("bluetooth_connected") and st.get("audio_sink_present") and st.get("audio_sink_default"))
else:
    out["success"]=False
out["result"]="CONNECTED_VERIFIED" if out["success"] else ("HTS_VISIBLE_NOT_CONNECTED" if hit else "HTS_NOT_VISIBLE_AFTER_SAFE_RECOVERY")
print(json.dumps(out,indent=2,sort_keys=True))
print("RESULT="+out["result"])
