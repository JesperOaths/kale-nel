#!/usr/bin/env python3
import json,time,urllib.request,urllib.error,pathlib,subprocess

def req(port,path,method="GET",timeout=120):
    r=urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method)
    t=time.monotonic()
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:d=json.loads(raw)
            except:d={"raw":raw[:6000]}
            return {"ok":200<=x.status<300,"status":x.status,"elapsed":round(time.monotonic()-t,2),"data":d}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","replace")
        try:d=json.loads(raw)
        except:d={"raw":raw[:6000]}
        return {"ok":False,"status":e.code,"elapsed":round(time.monotonic()-t,2),"data":d}
    except Exception as e:
        return {"ok":False,"status":0,"elapsed":round(time.monotonic()-t,2),"error":repr(e)}

out={}
out["before_power"]=req(8789,"/ht-e6500/power-state",timeout=10)
out["before_bt"]=req(8790,"/state",timeout=8)
out["ensure"]=req(8790,"/hts/ensure-on-safe","POST",timeout=160)
out["after_power"]=req(8789,"/ht-e6500/power-state",timeout=10)
out["after_bt"]=req(8790,"/state",timeout=8)
bt=out["after_bt"].get("data") or {}
ens=out["ensure"].get("data") or {}
summary={
 "ensure_http_ok":out["ensure"].get("ok"),
 "ensure_status":out["ensure"].get("status"),
 "ensure_state":ens.get("state"),
 "ensure_failure":ens.get("failure"),
 "bluetooth_connected":bool(bt.get("bluetooth_connected")),
 "audio_sink_present":bool(bt.get("audio_sink_present")),
 "audio_sink_default":bool(bt.get("audio_sink_default")),
 "power_after":(out["after_power"].get("data") or {}).get("state"),
}
# Pull just the decision steps so the remote job output stays readable.
decision=[]
for s in ens.get("steps") or []:
    a=s.get("action")
    if a in ("full_eight_source_sweep_before_power_toggle","single_power_toggle_after_complete_source_ring",
             "post_power_boot_visibility","full_eight_source_sweep_to_bt","prearm_bredr_discovery_before_power_decision",
             "pair_connect_select_sink","quick_connect_current_hts_source"):
        r=s.get("result") or {}
        decision.append({"action":a,"ok":r.get("ok"),"visible":r.get("visible"),"visible_cycle":r.get("visible_cycle"),
                         "failure":r.get("failure"),"state_json":r.get("state_json")})
summary["decision_steps"]=decision
print(json.dumps(summary,indent=2,sort_keys=True))
p=pathlib.Path("/home/jespern/c720p-home-hub/logs")/f"hts-v875-test-{time.strftime('%Y%m%d_%H%M%S')}.json"
p.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
print("LOG="+str(p))
print("RESULT=V875_HTS_PASS" if summary["bluetooth_connected"] and summary["audio_sink_present"] and summary["audio_sink_default"] else "RESULT=V875_HTS_FAIL")
