#!/usr/bin/env python3
import subprocess,time,json,urllib.request,urllib.error,pathlib,hashlib

SER="993e96d0"
MAC="8C:C8:CD:8B:06:3B"
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
CAND=pathlib.Path("/tmp/s5irbridge-v875.apk")
BACK=pathlib.Path("/home/jespern/c720p-backups")/("v893-function-apk-"+time.strftime("%Y%m%d_%H%M%S"))
BACK.mkdir(parents=True,exist_ok=True)

def run(cmd,timeout=30):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return {"rc":p.returncode,"out":(p.stdout or "")[-12000:]}

def req(path,method="GET",timeout=12):
    r=urllib.request.Request("http://127.0.0.1:8789"+path,method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:d=json.loads(raw)
            except:d={"raw":raw}
            return {"ok":200<=x.status<300,"status":x.status,"data":d}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","replace")
        try:d=json.loads(raw)
        except:d={"raw":raw}
        return {"ok":False,"status":e.code,"data":d}
    except Exception as e:
        return {"ok":False,"error":repr(e)}

if not CAND.exists():
    raise SystemExit("candidate APK missing: "+str(CAND))

pm=run(["adb","-s",SER,"shell","pm","path","com.bruis.s5irbridge"],10)
remote=""
for line in pm["out"].splitlines():
    if line.startswith("package:"):
        remote=line.split("package:",1)[1].strip()
        break
current=BACK/"current-before.apk"
if remote:
    pull=run(["adb","-s",SER,"pull",remote,str(current)],30)
    print("BACKUP_PULL",json.dumps(pull,separators=(",",":")))
print("BACKUP",BACK)
if current.exists():
    print("CURRENT_SHA",hashlib.sha256(current.read_bytes()).hexdigest(),current.stat().st_size)
print("CAND_SHA",hashlib.sha256(CAND.read_bytes()).hexdigest(),CAND.stat().st_size)

ins=run(["adb","-s",SER,"install","-r",str(CAND)],60)
print("INSTALL",json.dumps(ins,separators=(",",":")))
if ins["rc"]!=0:
    raise SystemExit(31)
time.sleep(1.2)

# Keep the receiver power action bounded: one toggle only if no live evidence.
ps=req("/ht-e6500/power-state")
print("POWER_BEFORE",json.dumps(ps,separators=(",",":")))
state=str((ps.get("data") or {}).get("state") or "unknown").lower()
if state!="on":
    pw=req("/ht-e6500/power","POST",15)
    print("POWER_TOGGLE",json.dumps(pw,separators=(",",":")))
    time.sleep(7)

# Search all eight FUNCTION positions while BR/EDR discovery is active.
run(["bash","-lc","timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
scan=subprocess.Popen(["timeout","50","bluetoothctl","scan","bredr"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
visible=False
visible_cycle=None
for cycle in range(0,9):
    chk=run(["bash","-lc",f"bluetoothctl devices | grep -iE 'SamsungHTS|{MAC}' || true"],5)
    print("SCAN",cycle,repr(chk["out"].strip()))
    if chk["out"].strip():
        visible=True
        visible_cycle=cycle
        break
    if cycle==8:
        break
    fn=req("/ht-e6500/function-fast","POST",8)
    print("FUNCTION",cycle+1,json.dumps(fn,separators=(",",":")))
    deadline=time.monotonic()+2.7
    while time.monotonic()<deadline:
        time.sleep(.3)
        chk=run(["bash","-lc",f"bluetoothctl devices | grep -iE 'SamsungHTS|{MAC}' || true"],5)
        if chk["out"].strip():
            visible=True
            visible_cycle=cycle+1
            break
    if visible:
        break
try: scan.terminate()
except Exception: pass
run(["bash","-lc","timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
print("VISIBLE",visible,"CYCLE",visible_cycle)

connector=None
if visible:
    connector=run([str(BASE/"bin/c720p-samsung-bluetooth-connect.sh")],110)
    print("CONNECTOR",json.dumps(connector,separators=(",",":")))

sf=BASE/"samsung-bluetooth-state.json"
bt={}
if sf.exists():
    try: bt=json.loads(sf.read_text())
    except Exception: pass
print("BT_STATE",json.dumps(bt,separators=(",",":")))
ok=bool(bt.get("bluetooth_connected") and bt.get("audio_sink_present") and bt.get("audio_sink_default"))
print("RESULT_V893_FUNCTION_APK","PASS" if ok else "FAIL")

if not ok and current.exists():
    rb=run(["adb","-s",SER,"install","-r",str(current)],60)
    print("ROLLBACK",json.dumps(rb,separators=(",",":")))
    print("RESULT_CURRENT_APK_RESTORED",rb["rc"]==0)
    if rb["rc"]!=0:
        raise SystemExit(32)

if not ok:
    raise SystemExit(3)
