#!/usr/bin/env python3
import subprocess,time,json,urllib.request,urllib.error,pathlib,hashlib,os,shutil,glob

SER="993e96d0"
MAC="8C:C8:CD:8B:06:3B"
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
OLD=BASE/"tmp/s5-ir-parity/installed-current.apk"
BACK=pathlib.Path("/home/jespern/c720p-backups")/("v875-s5-known-good-"+time.strftime("%Y%m%d_%H%M%S"))
BACK.mkdir(parents=True,exist_ok=True)

def run(cmd,timeout=30):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return {"rc":p.returncode,"out":(p.stdout or "")[-8000:]}

def req(path,method="GET",timeout=10):
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
    except Exception as e:return {"ok":False,"error":repr(e)}

# fresh backup of currently installed app
pm=run(["adb","-s",SER,"shell","pm","path","com.bruis.s5irbridge"],10)
remote=""
for line in pm["out"].splitlines():
    if line.startswith("package:"): remote=line.split("package:",1)[1].strip(); break
current=BACK/"current-before.apk"
if remote:
    run(["adb","-s",SER,"pull",remote,str(current)],25)
print("BACKUP",BACK)
if current.exists(): print("CURRENT_SHA",hashlib.sha256(current.read_bytes()).hexdigest(),current.stat().st_size)
print("OLD_SHA",hashlib.sha256(OLD.read_bytes()).hexdigest(),OLD.stat().st_size)

ins=run(["adb","-s",SER,"install","-r",str(OLD)],45)
print("INSTALL_OLD",json.dumps(ins,separators=(",",":")))
if ins["rc"]!=0: raise SystemExit(31)
time.sleep(1)
print("POWER_BEFORE",json.dumps(req("/ht-e6500/power-state"),separators=(",",":")))

# If no live evidence, one raw power toggle only. Then poll for live receiver evidence.
pstate=req("/ht-e6500/power-state")
st=str((pstate.get("data") or {}).get("state") or "unknown")
if st!="on":
    pw=req("/ht-e6500/power","POST",12)
    print("POWER_TOGGLE",json.dumps(pw,separators=(",",":")))
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        time.sleep(.75)
        ps=req("/ht-e6500/power-state")
        print("POWER_POLL",json.dumps(ps,separators=(",",":")))
        if str((ps.get("data") or {}).get("state") or "")=="on": break

# Scan BR/EDR while sweeping FUNCTION exactly as the proven 2026-09-26 cold-start did.
scan=subprocess.Popen(["timeout","35","bluetoothctl","scan","bredr"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
visible=False
visible_cycle=None
for cycle in range(0,9):
    chk=run(["bash","-lc",f"bluetoothctl devices | grep -iE 'SamsungHTS|{MAC}' || true"],5)
    print("SCAN",cycle,repr(chk["out"].strip()))
    if chk["out"].strip():
        visible=True;visible_cycle=cycle;break
    if cycle==8: break
    fn=req("/ht-e6500/function-fast","POST",8)
    print("FUNCTION",cycle+1,json.dumps(fn,separators=(",",":")))
    # WAIT -> READY can take ~2 s; probe multiple times.
    for _ in range(7):
        time.sleep(.3)
        chk=run(["bash","-lc",f"bluetoothctl devices | grep -iE 'SamsungHTS|{MAC}' || true"],5)
        if chk["out"].strip():
            visible=True;visible_cycle=cycle+1;break
    if visible: break
try: scan.terminate()
except: pass
run(["bash","-lc","timeout 2 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
print("VISIBLE",visible,"CYCLE",visible_cycle)

conn=None
if visible:
    conn=run([str(BASE/"bin/c720p-samsung-bluetooth-connect.sh")],75)
    print("CONNECT",json.dumps(conn,separators=(",",":")))
state={}
sf=BASE/"samsung-bluetooth-state.json"
if sf.exists():
    try: state=json.loads(sf.read_text())
    except: pass
print("BT_STATE",json.dumps(state,separators=(",",":")))
ok=bool(state.get("bluetooth_connected") and state.get("audio_sink_present") and state.get("audio_sink_default"))
print("RESULT_KNOWN_GOOD_S5", "PASS" if ok else "FAIL")
if not ok and current.exists():
    rb=run(["adb","-s",SER,"install","-r",str(current)],45)
    print("ROLLBACK_CURRENT",json.dumps(rb,separators=(",",":")))
    print("RESULT_CURRENT_APK_RESTORED",rb["rc"]==0)
