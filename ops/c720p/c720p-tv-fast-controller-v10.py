#!/usr/bin/env python3
import json, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT=8792
HT="http://127.0.0.1:8789"
BT="http://127.0.0.1:8790"

def request(base,path,method="GET",timeout=8):
    t=time.perf_counter()
    req=urllib.request.Request(base+path,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            raw=r.read()
            try:data=json.loads(raw.decode() or "{}")
            except Exception:data={"raw":raw.decode(errors="replace")[:1500]}
            return {"ok":200<=r.status<300,"status":r.status,"data":data,"ms":round((time.perf_counter()-t)*1000)}
    except urllib.error.HTTPError as e:
        try:data=json.loads(e.read().decode())
        except Exception:data={"error":str(e)}
        return {"ok":False,"status":e.code,"data":data,"ms":round((time.perf_counter()-t)*1000)}
    except Exception as e:
        return {"ok":False,"status":0,"data":{"error":type(e).__name__+":"+str(e)[:240]},"ms":round((time.perf_counter()-t)*1000)}

def live_ready(d):
    return bool(d.get("live_ready") and d.get("bluetooth_connected") and d.get("audio_sink_present") and d.get("audio_sink_default"))

def states():
    with ThreadPoolExecutor(max_workers=4) as ex:
        ftv=ex.submit(request,HT,"/grundig-tv/power-state","GET",5)
        ftvs=ex.submit(request,HT,"/grundig-tv/status","GET",5)
        fht=ex.submit(request,HT,"/ht-e6500/power-state","GET",6)
        fbt=ex.submit(request,BT,"/state","GET",5)
        tv,tvs_raw,ht,bt=ftv.result(),ftvs.result(),fht.result(),fbt.result()
    primary=str((tv.get("data") or {}).get("state","unknown")).lower() if tv.get("ok") else "unknown"
    status_data=tvs_raw.get("data") or {}
    status_bool=status_data.get("is_on")
    secondary="on" if status_bool is True else "off" if status_bool is False else "unknown"
    if primary in ("on","off") and secondary in ("on","off") and primary!=secondary:
        tvs="unknown"
    elif primary in ("on","off"):
        tvs=primary
    elif secondary in ("on","off"):
        tvs=secondary
    else:
        tvs="unknown"
    htd=ht.get("data") or {}
    hts=str(htd.get("state","unknown")).lower() if ht.get("ok") else "unknown"
    if hts not in ("on","off"): hts="unknown"
    btd=bt.get("data") or {}
    return {
      "ok":bool(tv.get("ok") or tvs_raw.get("ok") or ht.get("ok") or bt.get("ok")),
      "tv":tvs,"hts":hts,
      "hts_present":htd.get("present"),
      "hts_connected":htd.get("connected"),
      "bluetooth_connected":bool(btd.get("bluetooth_connected")),
      "audio_sink_present":bool(btd.get("audio_sink_present")),
      "audio_sink_default":bool(btd.get("audio_sink_default")),
      "live_ready":live_ready(btd),
      "pipeline_state":btd.get("pipeline_state") or btd.get("state") or "unknown",
      "pipeline_running":bool(btd.get("pipeline_running")),
      "pipeline_failure":btd.get("pipeline_failure"),
      "last_pipeline_state":btd.get("last_pipeline_state"),
      "last_pipeline_failure":btd.get("last_pipeline_failure"),
      "timings_ms":{"tv_power":tv.get("ms"),"tv_status":tvs_raw.get("ms"),"hts":ht.get("ms"),"bt":bt.get("ms")},
      "tv_sources":{"power_state":primary,"status":secondary},
    }

def sendj(h,obj,code=200):
    body=json.dumps(obj,separators=(",",":")).encode()
    h.send_response(code)
    h.send_header("Content-Type","application/json")
    h.send_header("Content-Length",str(len(body)))
    h.send_header("Cache-Control","no-store")
    h.send_header("Access-Control-Allow-Origin","*")
    h.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS")
    h.send_header("Access-Control-Allow-Headers","content-type")
    h.end_headers()
    h.wfile.write(body)

class H(BaseHTTPRequestHandler):
    def log_message(self,*args):return
    def do_OPTIONS(self):sendj(self,{},204)
    def do_GET(self):
        if self.path=="/health":return sendj(self,{"ok":True,"service":"c720p-tv-fast-controller","version":10})
        if self.path=="/state":return sendj(self,states())
        return sendj(self,{"ok":False,"error":"not_found"},404)
    def do_POST(self):
        if self.path=="/macro/start":
            r=request(BT,"/pipeline/bluetooth-fast","POST",8)
            return sendj(self,{"ok":r.get("ok"),"result":r},202 if r.get("ok") else 502)
        if self.path=="/tv/toggle":
            st=states();cur=st["tv"]
            if cur not in ("on","off"):
                return sendj(self,{"ok":False,"error":"tv_state_unknown","state":cur},409)
            target="off" if cur=="on" else "on"
            r=request(HT,"/grundig-tv/"+target,"POST",25)
            return sendj(self,{"ok":r.get("ok"),"target":target,"result":r},200 if r.get("ok") else 502)
        if self.path=="/hts/toggle":
            st=states();cur=st["hts"]
            if cur=="on":
                path="/ht-e6500/ensure-off";target="off"
            else:
                # Unknown is common while the receiver is genuinely off. The
                # guarded ensure-on route owns the single-toggle/no-double-toggle policy.
                path="/ht-e6500/ensure-on";target="on"
            r=request(HT,path,"POST",25)
            return sendj(self,{"ok":r.get("ok"),"target":target,"previous":cur,"result":r},200 if r.get("ok") else 502)
        if self.path=="/volume/up":
            r=request(HT,"/ht-e6500/volume/up","POST",8);return sendj(self,r,200 if r.get("ok") else 502)
        if self.path=="/volume/down":
            r=request(HT,"/ht-e6500/volume/down","POST",8);return sendj(self,r,200 if r.get("ok") else 502)
        if self.path=="/spotify/open":
            r=request(BT,"/spotify/open","POST",10);return sendj(self,r,200 if r.get("ok") else 502)
        return sendj(self,{"ok":False,"error":"not_found"},404)

ThreadingHTTPServer(("0.0.0.0",PORT),H).serve_forever()
