#!/usr/bin/env python3
import pathlib,subprocess,time,json,urllib.request,urllib.error,hashlib,re,shutil

SER="993e96d0"
PKG="com.bruis.s5irbridge"
OLD=pathlib.Path("/home/jespern/c720p-home-hub/tmp/s5-ir-cert-check/installed.apk")
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=pathlib.Path("/home/jespern/c720p-backups")/f"v875c-exact-1708-stack-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)

def run(cmd,timeout=60):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return {"rc":p.returncode,"out":(p.stdout or "")[-10000:]}

def req(port,path,method="GET",timeout=180):
    r=urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:d=json.loads(raw)
            except Exception:d={"raw":raw[:10000]}
            return {"ok":200<=x.status<300,"status":x.status,"data":d}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","replace")
        try:d=json.loads(raw)
        except Exception:d={"raw":raw[:10000]}
        return {"ok":False,"status":e.code,"data":d}
    except Exception as e:
        return {"ok":False,"status":0,"error":repr(e)}

# Preserve current APK exactly.
pm=run(["adb","-s",SER,"shell","pm","path",PKG],10)
remote=""
for line in pm["out"].splitlines():
    if line.startswith("package:"):
        remote=line.split("package:",1)[1].strip(); break
CURRENT=BACK/"current-before.apk"
if remote:
    pull=run(["adb","-s",SER,"pull",remote,str(CURRENT)],30)
    print("PULL_CURRENT",json.dumps(pull,separators=(",",":")))
if CURRENT.exists():
    print("CURRENT_SHA="+hashlib.sha256(CURRENT.read_bytes()).hexdigest())
print("OLD_SHA="+hashlib.sha256(OLD.read_bytes()).hexdigest())

# Exact app known to be installed before the 17:08 successful pipeline.
ins=run(["adb","-s",SER,"install","-r",str(OLD)],60)
print("INSTALL_1708_APK",json.dumps(ins,separators=(",",":")))
if ins["rc"] != 0:
    raise SystemExit(31)
time.sleep(1.5)

# Prove source_input exists and function does not in this exact APK.
run(["adb","-s",SER,"logcat","-c"],10)
probe=run(["adb","-s",SER,"shell","am","broadcast","-n",PKG+"/.IrReceiver","-a",PKG+".SEND","--es","device","ht_e6500","--es","command","source_input"],10)
time.sleep(.5)
logs=run(["adb","-s",SER,"logcat","-d","-s","S5IRBridge:I","*:S"],10)
print("SOURCE_INPUT_PROBE",json.dumps(probe,separators=(",",":")))
print("SOURCE_INPUT_LOG",repr(logs["out"][-2500:]))

# Restart helper so state is clean, then run the current v875b safe path,
# which now uses source_input and a full eight-source sweep.
run(["systemctl","--user","restart","ht-e6500-surround.service","c720p-bluetooth-helper.service"],20)
time.sleep(1)
before=req(8789,"/ht-e6500/power-state",timeout=10)
ensure=req(8790,"/hts/ensure-on-safe","POST",timeout=190)
after=req(8790,"/state",timeout=10)
pafter=req(8789,"/ht-e6500/power-state",timeout=10)
bt=after.get("data") or {}
ed=ensure.get("data") or {}
summary={
 "before_power":(before.get("data") or {}).get("state"),
 "ensure_ok":ensure.get("ok"),
 "ensure_status":ensure.get("status"),
 "ensure_state":ed.get("state"),
 "ensure_failure":ed.get("failure"),
 "bluetooth_connected":bool(bt.get("bluetooth_connected")),
 "audio_sink_present":bool(bt.get("audio_sink_present")),
 "audio_sink_default":bool(bt.get("audio_sink_default")),
 "power_after":(pafter.get("data") or {}).get("state"),
}
print("SUMMARY="+json.dumps(summary,sort_keys=True))
ok=summary["bluetooth_connected"] and summary["audio_sink_present"] and summary["audio_sink_default"]
print("RESULT=V875C_EXACT_STACK_PASS" if ok else "RESULT=V875C_EXACT_STACK_FAIL")

# Keep exact historical APK only if it actually restores the full audio path.
if not ok and CURRENT.exists():
    rb=run(["adb","-s",SER,"install","-r",str(CURRENT)],60)
    print("ROLLBACK_CURRENT",json.dumps(rb,separators=(",",":")))
    print("RESULT=CURRENT_APK_RESTORED" if rb["rc"]==0 else "RESULT=CURRENT_APK_ROLLBACK_FAILED")
else:
    print("RESULT=HISTORICAL_APK_RETAINED")
