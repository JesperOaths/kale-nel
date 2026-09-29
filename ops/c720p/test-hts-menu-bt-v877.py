#!/usr/bin/env python3
import subprocess,time,urllib.request,urllib.error,json
MAC="8C:C8:CD:8B:06:3B"

def run(cmd,timeout=15):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return p.returncode,(p.stdout or "")

def post(path,timeout=8):
    r=urllib.request.Request("http://127.0.0.1:8789"+path,method="POST")
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:data=json.loads(raw)
            except:data={"raw":raw}
            return {"ok":200<=x.status<300,"status":x.status,"data":data}
    except urllib.error.HTTPError as e:
        return {"ok":False,"status":e.code,"raw":e.read().decode("utf-8","replace")[:2000]}
    except Exception as e:
        return {"ok":False,"error":repr(e)}

def visible():
    rc,out=run(["bash","-lc",f"bluetoothctl devices | grep -iE 'SamsungHTS|{MAC}' || true"],5)
    return bool(out.strip()),out.strip()

run(["bash","-lc","timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
scan=subprocess.Popen(["timeout","45","bluetoothctl","scan","bredr"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
seq=[("/ht-e6500/menu",1.2),("/ht-e6500/right",0.8),("/ht-e6500/right",0.8),("/ht-e6500/select",2.0),("/ht-e6500/up",0.8),("/ht-e6500/select",2.5)]
found=False
for idx,(path,delay) in enumerate(seq,1):
    res=post(path)
    print("STEP",idx,path,json.dumps(res,separators=(",",":")))
    deadline=time.monotonic()+delay
    while time.monotonic()<deadline:
        time.sleep(.25)
        vis,out=visible()
        if vis:
            print("VISIBLE_AFTER_STEP",idx,out)
            found=True
            break
    if found: break
try: scan.terminate()
except: pass
run(["bash","-lc","timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true"],4)
print("VISIBLE",found)
if found:
    rc,out=run(["/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh"],75)
    print("CONNECT_RC",rc)
    print(out[-12000:])
print("RESULT_MENU_BT","PASS" if found else "NOT_VISIBLE")
