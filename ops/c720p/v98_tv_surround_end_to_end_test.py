from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
import json,time,subprocess

def call(port,path,method="GET",timeout=45):
    url=f"http://127.0.0.1:{port}{path}"
    req=Request(url,method=method,headers={"Content-Type":"application/json"})
    try:
        with urlopen(req,timeout=timeout) as r:
            body=r.read().decode("utf-8","replace")
            try:data=json.loads(body)
            except:data={"raw":body}
            return {"http":r.status,"ok":bool(data.get("ok",r.status<400)),"data":data}
    except HTTPError as e:
        body=e.read().decode("utf-8","replace")
        try:data=json.loads(body)
        except:data={"raw":body}
        return {"http":e.code,"ok":False,"data":data}
    except Exception as e:
        return {"http":None,"ok":False,"error":repr(e)}

def tv_state():
    r=call(8789,"/grundig-tv/power-state",timeout=20)
    return r,(r.get("data") or {}).get("is_on")

def hts_state():
    r=call(8789,"/ht-e6500/power-state",timeout=20)
    return r,(r.get("data") or {}).get("is_on")

def wait_tv(want,limit=35):
    end=time.time()+limit
    last=None
    while time.time()<end:
        last,on=tv_state()
        if on is want:return {"verified":True,"state":on,"last":last}
        time.sleep(2)
    return {"verified":False,"state":(last or {}).get("data",{}).get("is_on"),"last":last}

def wait_pipeline(limit=50):
    end=time.time()+limit; last=None
    while time.time()<end:
        last=call(8790,"/state",timeout=10)
        d=last.get("data") or {}
        if not d.get("pipeline_running"): return last
        time.sleep(2)
    return last

report={}
itv,itv_on=tv_state(); iht,iht_on=hts_state()
report["initial"]={"tv":itv,"tv_on":itv_on,"hts":iht,"hts_on":iht_on,"media":call(8790,"/state",timeout=10),"ir_health":call(8789,"/health",timeout=15)}

# S5 recovery path
report["s5_reconnect"]=call(8789,"/s5/reconnect","POST",timeout=40)
report["ir_after_reconnect"]=call(8789,"/health",timeout=15)
irdata=report["ir_after_reconnect"].get("data") or {}
ir_ready=bool(irdata.get("s5_connected") or (irdata.get("s5_http") or {}).get("ok"))

# Spotify button
report["spotify_open"]=call(8790,"/spotify/open","POST",timeout=15)

# HTS button. If it succeeds, restore off unless it was explicitly on before.
report["hts_on"]=call(8789,"/ht-e6500/ensure-on","POST",timeout=45)
if report["hts_on"]["ok"]:
    time.sleep(2)
    report["hts_after_on"]=hts_state()[0]
    if iht_on is not True:
        report["hts_restore_off"]=call(8789,"/ht-e6500/ensure-off","POST",timeout=45)
        time.sleep(2)
        report["hts_after_restore"]=hts_state()[0]

# Volume buttons: pair + then - so a working route returns approximately to the same level.
report["volume_up"]=call(8789,"/ht-e6500/volume/up","POST",timeout=20)
report["volume_down"]=call(8789,"/ht-e6500/volume/down","POST",timeout=20)

# Connect Surround button. It is async on 8790; poll result, then restore TV/HTS if possible.
report["surround_start"]=call(8790,"/pipeline/bluetooth-fast","POST",timeout=15)
time.sleep(2)
report["surround_result"]=wait_pipeline(55)

# TV button: verify both directions, then restore original state.
report["tv_on_action"]=call(8789,"/grundig-tv/on","POST",timeout=35)
report["tv_on_verify"]=wait_tv(True,35)
report["tv_off_action"]=call(8789,"/grundig-tv/off","POST",timeout=35)
report["tv_off_verify"]=wait_tv(False,35)
if itv_on is True:
    report["tv_restore"]=call(8789,"/grundig-tv/on","POST",timeout=35)
    report["tv_restore_verify"]=wait_tv(True,35)
else:
    # Surround may also have turned it on; ensure original OFF state.
    report["tv_restore"]=call(8789,"/grundig-tv/off","POST",timeout=35)
    report["tv_restore_verify"]=wait_tv(False,35)

# If Surround managed to power/connect HTS and it wasn't originally on, restore off if IR is now usable.
_,final_hts=hts_state()
if iht_on is not True and final_hts is True:
    report["hts_final_restore"]=call(8789,"/ht-e6500/ensure-off","POST",timeout=45)

report["final"]={"tv":tv_state()[0],"hts":hts_state()[0],"media":call(8790,"/state",timeout=10),"ir_health":call(8789,"/health",timeout=15)}
print(json.dumps(report,indent=2))
