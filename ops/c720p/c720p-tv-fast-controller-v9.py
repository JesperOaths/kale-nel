#!/usr/bin/env python3
import json, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT=8792
HT="http://127.0.0.1:8789"
BT="http://127.0.0.1:8790"
lock=threading.Lock()
macro={"state":"idle","started_at":None,"finished_at":None,"ok":None,"stage":"idle","error":None,"steps":[]}

def request(base,path,method="GET",timeout=8):
    t=time.perf_counter()
    req=urllib.request.Request(base+path,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            raw=r.read()
            try: data=json.loads(raw.decode() or "{}")
            except: data={"raw":raw.decode(errors="replace")[:2000]}
            return {"ok":200 <= r.status < 300,"status":r.status,"data":data,"ms":round((time.perf_counter()-t)*1000)}
    except urllib.error.HTTPError as e:
        try: data=json.loads(e.read().decode())
        except: data={"error":str(e)}
        return {"ok":False,"status":e.code,"data":data,"ms":round((time.perf_counter()-t)*1000)}
    except Exception as e:
        return {"ok":False,"status":0,"data":{"error":type(e).__name__+":"+str(e)[:300]},"ms":round((time.perf_counter()-t)*1000)}

def states():
    with ThreadPoolExecutor(max_workers=3) as ex:
        f_tv=ex.submit(request,HT,"/grundig-tv/power-state","GET",3)
        f_ht=ex.submit(request,HT,"/ht-e6500/power-state","GET",3)
        f_bt=ex.submit(request,BT,"/state","GET",3)
        tv,ht,bt=f_tv.result(),f_ht.result(),f_bt.result()
    tvs=str((tv.get("data") or {}).get("state","unknown")).lower() if tv.get("ok") else "unknown"
    hts=str((ht.get("data") or {}).get("state","unknown")).lower() if ht.get("ok") else "unknown"
    btd=bt.get("data") or {}
    return {
        "ok":bool(tv.get("ok") or ht.get("ok") or bt.get("ok")),
        "tv":tvs if tvs in ("on","off") else "unknown",
        "hts":hts if hts in ("on","off") else "unknown",
        "bluetooth_connected":bool(btd.get("bluetooth_connected")),
        "bluetooth_paired":bool(btd.get("bluetooth_paired")),
        "audio_sink_present":bool(btd.get("audio_sink_present")),
        "audio_sink_default":bool(btd.get("audio_sink_default")),
        "timings_ms":{"tv":tv.get("ms"),"hts":ht.get("ms"),"bt":bt.get("ms")},
        "macro":dict(macro),
    }

def add_step(name,res):
    macro["steps"].append({"stage":name,"result":res})
    if len(macro["steps"])>20: macro["steps"]=macro["steps"][-20:]

def run_macro():
    if not lock.acquire(blocking=False):
        return
    try:
        macro.update({"state":"running","started_at":time.time(),"finished_at":None,"ok":None,"stage":"read_state","error":None,"steps":[]})
        st=states()
        add_step("initial_state",st)
        macro["stage"]="power"
        with ThreadPoolExecutor(max_workers=2) as ex:
            ftv=None if st["tv"]=="on" else ex.submit(request,HT,"/grundig-tv/on","POST",15)
            fht=None if st["hts"]=="on" else ex.submit(request,HT,"/ht-e6500/ensure-on","POST",12)
            tvp={"ok":True,"skipped":"already_on"} if ftv is None else ftv.result()
            htp={"ok":True,"skipped":"already_on"} if fht is None else fht.result()
        add_step("tv_power",tvp); add_step("hts_power",htp)
        if not tvp.get("ok"):
            raise RuntimeError("TV_POWER_FAILED")
        if not htp.get("ok"):
            raise RuntimeError("HTS_POWER_FAILED")

        macro["stage"]="inputs"
        # These are independent. Selecting BT no longer waits for HDMI3 and vice versa.
        with ThreadPoolExecutor(max_workers=2) as ex:
            fhd=ex.submit(request,HT,"/grundig-tv/hdmi3","POST",7)
            fbt=ex.submit(request,HT,"/ht-e6500/bluetooth-mode","POST",18)
            hd=fhd.result(); hm=fbt.result()
        add_step("tv_hdmi3",hd); add_step("hts_bluetooth_mode",hm)
        if not hd.get("ok"):
            raise RuntimeError("TV_HDMI3_FAILED")
        if not hm.get("ok"):
            raise RuntimeError("HTS_BLUETOOTH_MODE_FAILED")

        macro["stage"]="connect"
        con=request(BT,"/connect","POST",20)
        add_step("bluetooth_connect",con)
        if not con.get("ok"):
            raise RuntimeError("BLUETOOTH_CONNECT_FAILED")

        # Short bounded verification. No recovery/restart fallback exists here.
        deadline=time.monotonic()+4.0
        final=None
        while True:
            final=states()
            if final.get("tv")=="on" and final.get("hts")=="on" and final.get("bluetooth_connected"):
                break
            if time.monotonic()>=deadline:
                break
            time.sleep(.35)
        add_step("final_state",final)
        macro["ok"]=bool(final and final.get("tv")=="on" and final.get("hts")=="on")
        macro["state"]="done" if macro["ok"] else "partial"
        macro["stage"]="done"
        if not macro["ok"]: macro["error"]="FINAL_STATE_NOT_CONFIRMED"
    except Exception as e:
        macro["ok"]=False
        macro["state"]="error"
        macro["error"]=str(e)
    finally:
        macro["finished_at"]=time.time()
        lock.release()

class H(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): return
    def headers_common(self,code=200,ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type",ctype)
        self.send_header("Cache-Control","no-store")
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers","content-type")
        self.end_headers()
    def sendj(self,obj,code=200):
        self.headers_common(code)
        self.wfile.write(json.dumps(obj,separators=(",",":")).encode())
    def do_OPTIONS(self):
        self.headers_common(204)
    def do_GET(self):
        if self.path=="/health":
            return self.sendj({"ok":True,"service":"c720p-tv-fast-controller","version":9})
        if self.path=="/state":
            return self.sendj(states())
        return self.sendj({"ok":False,"error":"not_found"},404)
    def do_POST(self):
        if self.path=="/macro/start":
            if lock.locked(): return self.sendj({"ok":True,"accepted":False,"state":"already_running"},202)
            threading.Thread(target=run_macro,daemon=True).start()
            return self.sendj({"ok":True,"accepted":True,"state":"starting"},202)
        if self.path in ("/tv/toggle","/hts/toggle"):
            st=states(); key="tv" if self.path.startswith("/tv") else "hts"; cur=st[key]
            if cur not in ("on","off"):
                return self.sendj({"ok":False,"error":key+"_state_unknown","state":cur},409)
            target="off" if cur=="on" else "on"
            path=("/grundig-tv/"+target) if key=="tv" else ("/ht-e6500/ensure-"+target)
            res=request(HT,path,"POST",15)
            return self.sendj({"ok":res.get("ok"),"target":target,"result":res},200 if res.get("ok") else 502)
        if self.path=="/volume/up":
            res=request(HT,"/ht-e6500/volume/up","POST",5); return self.sendj(res,200 if res.get("ok") else 502)
        if self.path=="/volume/down":
            res=request(HT,"/ht-e6500/volume/down","POST",5); return self.sendj(res,200 if res.get("ok") else 502)
        if self.path=="/spotify/open":
            res=request(BT,"/spotify/open","POST",8); return self.sendj(res,200 if res.get("ok") else 502)
        return self.sendj({"ok":False,"error":"not_found"},404)

ThreadingHTTPServer(("127.0.0.1",PORT),H).serve_forever()
