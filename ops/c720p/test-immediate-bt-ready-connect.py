import urllib.request,json,time,subprocess
MAC="8C:C8:CD:8B:06:3B"
def post(path,timeout=30):
    t=time.perf_counter()
    req=urllib.request.Request("http://127.0.0.1:8789"+path,method="POST")
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,json.load(r),time.perf_counter()-t
    except Exception as e:return 0,{"error":repr(e)},time.perf_counter()-t
def run(cmd,timeout=10):
    t=time.perf_counter()
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        return p.returncode,p.stdout,p.stderr,time.perf_counter()-t
    except subprocess.TimeoutExpired as e:
        return 124,(e.stdout or "") if isinstance(e.stdout,str) else "","timeout",time.perf_counter()-t

code,obj,sec=post("/ht-e6500/bluetooth-mode",30)
print("BTMODE_HTTP="+str(code)+" SEC=%.2f"%sec+" OK="+str(obj.get("ok")))
rc,out,err,sec=run(["timeout","8","bluetoothctl","--agent","NoInputNoOutput","connect",MAC],10)
print("CONNECT_RC="+str(rc)+" SEC=%.2f"%sec+" OUT="+out.replace("\n",";")[:2000]+" ERR="+err.replace("\n",";")[:1000])
rc,out,err,sec=run(["timeout","4","bluetoothctl","info",MAC],6)
print("INFO="+out.replace("\n",";")[:2000])
print("RESULT=IMMEDIATE_BT_READY_CONNECT_DONE")
