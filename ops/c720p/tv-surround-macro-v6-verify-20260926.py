import json,time,urllib.request,subprocess

def pid():
    return subprocess.run(["systemctl","--user","show","c720p-home-hub-kiosk.service","-p","MainPID","--value"],text=True,capture_output=True).stdout.strip()
def req(path,port=8789,method="GET",timeout=100):
    t=time.perf_counter()
    r=urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x: obj=json.load(x); code=x.status
    except urllib.error.HTTPError as e:
        code=e.code
        try: obj=json.loads(e.read().decode())
        except: obj={"error":str(e)}
    return obj,time.perf_counter()-t,code

print("KIOSK_PID_BEFORE="+pid())
tv0,dt,_=req("/grundig-tv/power-state",timeout=8)
ht0,_,_=req("/ht-e6500/power-state",timeout=8)
print("TV_BEFORE="+str(tv0.get("state"))+" source="+str(tv0.get("source"))+" ms=%.0f"%(dt*1000))
print("HTS_BEFORE="+str(ht0.get("state")))

m,dt,code=req("/pipeline/bluetooth-verified",8790,"POST",100)
print("MACRO_HTTP="+str(code))
print("MACRO_SECONDS=%.2f"%dt)
for k in ("ok","state","failure","tv_power","tv_input","hts_power","hts_input","bluetooth_connected","audio_sink_present","audio_sink_default","audio_sink"):
    print("MACRO_"+k.upper()+"="+str(m.get(k)))

for i in range(3):
    tv,dt,_=req("/grundig-tv/power-state",timeout=8)
    print(f"TV_AFTER_{i+1}="+str(tv.get("state"))+" source="+str(tv.get("source"))+" ms=%.0f"%(dt*1000))
    time.sleep(.5)
ht,_,_=req("/ht-e6500/power-state",timeout=8)
bt,_,_=req("/state",8790,timeout=8)
print("FINAL_HTS="+str(ht.get("state")))
print("FINAL_BT_CONNECTED="+str(bt.get("bluetooth_connected")))
print("FINAL_BT_PAIRED="+str(bt.get("bluetooth_paired")))
print("FINAL_AUDIO_SINK_PRESENT="+str(bt.get("audio_sink_present")))
print("FINAL_AUDIO_DEFAULT="+str(bt.get("audio_sink_default")))
print("KIOSK_PID_AFTER="+pid())
print("RESULT=TV_SURROUND_MACRO_V6_VERIFY_DONE")
