import json, time, urllib.request, subprocess

def get(path, port=8789, timeout=8):
    t=time.perf_counter()
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
        obj=json.load(r)
    return obj, time.perf_counter()-t

def post(path, port=8789, timeout=60):
    t=time.perf_counter()
    req=urllib.request.Request(f"http://127.0.0.1:{port}{path}", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            obj=json.load(r)
        return obj, time.perf_counter()-t, 200
    except urllib.error.HTTPError as e:
        try: obj=json.loads(e.read().decode())
        except Exception: obj={"error":str(e)}
        return obj, time.perf_counter()-t, e.code

def pid():
    p=subprocess.run(["systemctl","--user","show","c720p-home-hub-kiosk.service","-p","MainPID","--value"],text=True,capture_output=True)
    return p.stdout.strip()

def active():
    p=subprocess.run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],text=True,capture_output=True)
    return p.stdout.strip()

print("KIOSK_BEFORE_PID="+pid())
print("KIOSK_BEFORE_ACTIVE="+active())

tv0,dt=get("/grundig-tv/power-state")
print("TV_INITIAL_STATE="+str(tv0.get("state")))
print("TV_INITIAL_SOURCE="+str(tv0.get("source")))
print("TV_INITIAL_QUERY_MS=%.0f"%(dt*1000))

off,dt,code=post("/grundig-tv/off",timeout=25)
print("TV_OFF_HTTP="+str(code))
print("TV_OFF_SECONDS=%.2f"%dt)
print("TV_OFF_RESULT_STATE="+str(off.get("state")))
print("TV_OFF_CONFIRMED="+str(off.get("confirmed")))
tv1,dt=get("/grundig-tv/power-state")
print("TV_AFTER_OFF_STATE="+str(tv1.get("state")))
print("TV_AFTER_OFF_QUERY_MS=%.0f"%(dt*1000))

on,dt,code=post("/grundig-tv/on",timeout=30)
print("TV_ON_HTTP="+str(code))
print("TV_ON_SECONDS=%.2f"%dt)
print("TV_ON_RESULT_STATE="+str(on.get("state")))
print("TV_ON_CONFIRMED="+str(on.get("confirmed")))
tv2,dt=get("/grundig-tv/power-state")
print("TV_AFTER_ON_STATE="+str(tv2.get("state")))
print("TV_AFTER_ON_QUERY_MS=%.0f"%(dt*1000))

macro,dt,code=post("/pipeline/bluetooth-verified",port=8790,timeout=100)
print("MACRO_HTTP="+str(code))
print("MACRO_SECONDS=%.2f"%dt)
print("MACRO_OK="+str(macro.get("ok")))
print("MACRO_STATE="+str(macro.get("state")))
print("MACRO_TV_POWER="+str(macro.get("tv_power")))
print("MACRO_TV_INPUT="+str(macro.get("tv_input")))
print("MACRO_HTS_POWER="+str(macro.get("hts_power")))
print("MACRO_HTS_INPUT="+str(macro.get("hts_input")))
print("MACRO_BT_CONNECTED="+str(macro.get("bluetooth_connected")))
print("MACRO_AUDIO_SINK_DEFAULT="+str(macro.get("audio_sink_default")))
print("MACRO_FAILURE="+str(macro.get("failure")))

tv3,_=get("/grundig-tv/power-state")
ht3,_=get("/ht-e6500/power-state")
bt3,_=get("/state",port=8790)
print("FINAL_TV_STATE="+str(tv3.get("state")))
print("FINAL_HTS_STATE="+str(ht3.get("state")))
print("FINAL_BT_CONNECTED="+str(bt3.get("bluetooth_connected")))
print("FINAL_AUDIO_DEFAULT="+str(bt3.get("audio_sink_default")))
print("KIOSK_AFTER_PID="+pid())
print("KIOSK_AFTER_ACTIVE="+active())
print("RESULT=TV_SURROUND_PHYSICAL_VERIFY_DONE")
