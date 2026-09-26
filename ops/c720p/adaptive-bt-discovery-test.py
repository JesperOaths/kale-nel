import subprocess,time,json,urllib.request,urllib.error
MAC="8C:C8:CD:8B:06:3B"
def post(path,timeout=10):
    req=urllib.request.Request("http://127.0.0.1:8789"+path,method="POST")
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
        try:o=json.loads(e.read().decode())
        except:o={}
        return e.code,o
def run(cmd,timeout=8):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
        return p.returncode,p.stdout,p.stderr
    except subprocess.TimeoutExpired as e:
        return 124,(e.stdout or "") if isinstance(e.stdout,str) else "","timeout"

print("SEARCH_BEGIN")
found=False
for i in range(1,9):
    code,obj=post("/ht-e6500/source",10)
    print(f"CYCLE_{i}_IR_HTTP={code} OK={obj.get('ok')}")
    time.sleep(.55)
    rc,out,err=run(["timeout","2","stdbuf","-oL","bluetoothctl","scan","bredr"],4)
    run(["timeout","2","bluetoothctl","scan","off"],3)
    hit=MAC.lower() in (out+"\n"+err).lower()
    compact=(out+" "+err).replace("\n",";")[-1200:]
    print(f"CYCLE_{i}_ADVERT={hit} SCAN={compact}")
    if not hit:
        continue
    found=True
    print("FOUND_CYCLE="+str(i))
    rc,out,err=run(["timeout","8","bluetoothctl","--agent","NoInputNoOutput","connect",MAC],10)
    print("CONNECT_RC="+str(rc)+" OUT="+out.replace("\n",";")[:1800]+" ERR="+err.replace("\n",";")[:800])
    rc,info,err=run(["timeout","4","bluetoothctl","info",MAC],6)
    print("INFO="+info.replace("\n",";")[:1800])
    if "Connected: yes" in info:
        print("CONNECTED_CYCLE="+str(i))
        break
    # If connect did not implicitly pair, use a single bounded pair now that
    # the receiver source has been positively identified as advertising.
    rc,out,err=run(["timeout","7","bluetoothctl","--agent","NoInputNoOutput","pair",MAC],9)
    print("PAIR_RC="+str(rc)+" OUT="+out.replace("\n",";")[:1800]+" ERR="+err.replace("\n",";")[:800])
    rc,out,err=run(["timeout","7","bluetoothctl","--agent","NoInputNoOutput","connect",MAC],9)
    print("CONNECT2_RC="+str(rc)+" OUT="+out.replace("\n",";")[:1800])
    rc,info,err=run(["timeout","4","bluetoothctl","info",MAC],6)
    print("INFO2="+info.replace("\n",";")[:1800])
    if "Connected: yes" in info:
        print("CONNECTED_CYCLE="+str(i))
        break
print("FOUND_ANY="+str(found))
print("RESULT=ADAPTIVE_BT_DISCOVERY_TEST_DONE")
