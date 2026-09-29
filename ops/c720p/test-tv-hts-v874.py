#!/usr/bin/env python3
import json,time,urllib.request,urllib.error
from pathlib import Path

def req(port,path,method="GET",timeout=90):
    r=urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method)
    started=time.monotonic()
    try:
        with urllib.request.urlopen(r,timeout=timeout) as x:
            raw=x.read().decode("utf-8","replace")
            try:data=json.loads(raw)
            except Exception:data={"raw":raw[:4000]}
            return {"ok":200<=x.status<300,"status":x.status,"elapsed_s":round(time.monotonic()-started,3),"data":data}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","replace")
        try:data=json.loads(raw)
        except Exception:data={"raw":raw[:4000]}
        return {"ok":False,"status":e.code,"elapsed_s":round(time.monotonic()-started,3),"data":data}
    except Exception as e:
        return {"ok":False,"status":0,"elapsed_s":round(time.monotonic()-started,3),"error":repr(e)}

out={}
out["start_tv"]=req(8789,"/grundig-tv/power-state",timeout=12)
out["start_hts"]=req(8789,"/ht-e6500/power-state",timeout=12)
out["start_bt"]=req(8790,"/state",timeout=8)

out["hts_safe"]=req(8790,"/hts/ensure-on-safe","POST",timeout=90)
out["after_hts"]=req(8789,"/ht-e6500/power-state",timeout=12)
out["after_bt"]=req(8790,"/state",timeout=8)
out["after_hts_tv"]=req(8789,"/grundig-tv/power-state",timeout=12)

# Only test the combined macro after the HTS-only path has returned. It is
# asynchronous; poll its state to a terminal result.
out["macro_start"]=req(8790,"/pipeline/bluetooth-fast","POST",timeout=10)
for i in range(1,61):
    time.sleep(1)
    st=req(8790,"/state",timeout=6)
    out[f"macro_poll_{i}"]=st
    d=st.get("data") or {}
    if not d.get("pipeline_running") and (
        d.get("state") in ("connected_verified","connected")
        or d.get("pipeline_failure")
        or d.get("failure")
        or d.get("ok") is False
    ):
        break

out["final_tv"]=req(8789,"/grundig-tv/power-state",timeout=12)
out["final_hts"]=req(8789,"/ht-e6500/power-state",timeout=12)
out["final_bt"]=req(8790,"/state",timeout=8)

last=[(k,v) for k,v in out.items() if k.startswith("macro_poll_")]
last_key,last_val=last[-1] if last else ("macro_start",out["macro_start"])
summary={
    "hts_safe_http_ok":out["hts_safe"].get("ok"),
    "hts_safe_state":(out["hts_safe"].get("data") or {}).get("state"),
    "hts_bluetooth_connected":bool((out["final_bt"].get("data") or {}).get("bluetooth_connected")),
    "hts_sink_present":bool((out["final_bt"].get("data") or {}).get("audio_sink_present")),
    "hts_sink_default":bool((out["final_bt"].get("data") or {}).get("audio_sink_default")),
    "tv_after_hts":(out["after_hts_tv"].get("data") or {}).get("state"),
    "macro_terminal_key":last_key,
    "macro_terminal_state":(last_val.get("data") or {}).get("state"),
    "macro_failure":(last_val.get("data") or {}).get("pipeline_failure") or (last_val.get("data") or {}).get("failure"),
    "tv_final":(out["final_tv"].get("data") or {}).get("state"),
}
out["summary"]=summary
p=Path("/home/jespern/c720p-home-hub/logs")/f"tv-hts-v874-test-{time.strftime('%Y%m%d_%H%M%S')}.json"
p.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
print(json.dumps(summary,indent=2,sort_keys=True))
print("LOG="+str(p))

# TV_HTS_CLOUD_REPORT_V1
# Independent compact result path: useful if the normal agent completes the
# hardware test but its polling loop/tunnel becomes unstable immediately after.
try:
    token_path=Path("/home/jespern/.config/c720p-agent/security-token")
    token=token_path.read_text().strip()
    cloud_body={
        "observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "tv_hts_recovery":{
            "version":"v918-v919",
            "summary":summary,
            "log":str(p),
        },
    }
    cloud_req=urllib.request.Request(
        "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
        data=json.dumps(cloud_body,separators=(",",":")).encode(),
        method="POST",
        headers={"content-type":"application/json","x-c720p-token":token},
    )
    with urllib.request.urlopen(cloud_req,timeout=12) as cloud_res:
        print("CLOUD_REPORT_HTTP="+str(cloud_res.status))
except Exception as e:
    print("CLOUD_REPORT=DEGRADED "+repr(e))
