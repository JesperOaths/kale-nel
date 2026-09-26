import subprocess,time,json,urllib.request,urllib.error,os,signal

MAC="8C:C8:CD:8B:06:3B"

def run(cmd,timeout=12):
    t=time.perf_counter()
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        return {"rc":p.returncode,"out":p.stdout[-4000:],"err":p.stderr[-2000:],"sec":round(time.perf_counter()-t,2)}
    except subprocess.TimeoutExpired as e:
        return {"rc":124,"out":(e.stdout or "")[-4000:] if isinstance(e.stdout,str) else "","err":"timeout","sec":round(time.perf_counter()-t,2)}

def post(path,timeout=35):
    req=urllib.request.Request("http://127.0.0.1:8789"+path,method="POST")
    t=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status,json.load(r),round(time.perf_counter()-t,2)
    except urllib.error.HTTPError as e:
        try:o=json.loads(e.read().decode())
        except:o={}
        return e.code,o,round(time.perf_counter()-t,2)

print("KIOSK_PID="+run(["systemctl","--user","show","c720p-home-hub-kiosk.service","-p","MainPID","--value"],3)["out"].strip())
code,obj,sec=post("/ht-e6500/surround-bluetooth",35)
print("MENU_HTTP="+str(code))
print("MENU_SECONDS="+str(sec))
print("MENU_OK="+str(obj.get("ok")))
print("MENU_HT_ROUTE="+str(obj.get("ht_route")))
print("MENU_MACRO_OK="+str((obj.get("macro") or {}).get("ok")))

for cmd in [
    ["bluetoothctl","power","on"],
    ["bluetoothctl","pairable","on"],
    ["bluetoothctl","agent","NoInputNoOutput"],
    ["bluetoothctl","default-agent"],
    ["bluetoothctl","trust",MAC],
]:
    x=run(["timeout","4"]+cmd,6)
    print("CMD="+" ".join(cmd)+" RC="+str(x["rc"])+" OUT="+x["out"].replace("\n",";")[:500])

scan=subprocess.Popen(["timeout","10","bluetoothctl","scan","bredr"],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
time.sleep(1.0)
pair=run(["timeout","8","bluetoothctl","--agent","NoInputNoOutput","pair",MAC],10)
print("PAIR_RC="+str(pair["rc"])+" SEC="+str(pair["sec"])+" OUT="+pair["out"].replace("\n",";")[:1200])
info=run(["timeout","4","bluetoothctl","info",MAC],6)
print("INFO_AFTER_PAIR="+info["out"].replace("\n",";")[:1500])
if "Connected: yes" not in info["out"]:
    con=run(["timeout","7","bluetoothctl","connect",MAC],9)
    print("CONNECT_RC="+str(con["rc"])+" SEC="+str(con["sec"])+" OUT="+con["out"].replace("\n",";")[:1200])
try: scan.terminate()
except: pass
run(["timeout","3","bluetoothctl","scan","off"],5)
time.sleep(.5)
info2=run(["timeout","4","bluetoothctl","info",MAC],6)
print("FINAL_INFO="+info2["out"].replace("\n",";")[:1800])
print("RESULT=MENU_PAIR_TEST_DONE")
