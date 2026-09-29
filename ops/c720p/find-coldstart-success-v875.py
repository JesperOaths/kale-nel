#!/usr/bin/env python3
import pathlib,json,glob,re
B=pathlib.Path("/home/jespern/c720p-home-hub")
rows=[]
for f in sorted(glob.glob(str(B/"logs/tv-hts-bluetooth-pipeline-*.json"))):
    try:
        d=json.loads(pathlib.Path(f).read_text())
    except Exception: continue
    if not d.get("ok"): continue
    steps=d.get("steps") or []
    pre=None
    for s in steps:
        if s.get("check")=="hts_already_bluetooth_ready":
            pre=(s.get("result") or {}).get("ok")
            break
    actions=[s.get("action") for s in steps if s.get("action")]
    rows.append((f,pre,actions,d))
for f,pre,actions,d in rows:
    print(pathlib.Path(f).name,"preflight_bt_ready=",pre,"actions=","|".join(actions))
cands=[x for x in rows if x[1] is False or any(a and ("bluetooth" in a or "pair" in a or "connect" in a) for a in x[2])]
print("=== CANDIDATE_DETAILS ===")
for f,pre,actions,d in cands[-8:]:
    print("###",f,"pre",pre)
    for i,s in enumerate(d.get("steps") or []):
        r=s.get("result")
        mini={"stage":s.get("stage"),"check":s.get("check"),"action":s.get("action"),"cycle":s.get("cycle")}
        if isinstance(r,dict):
            mini["r"]={k:r.get(k) for k in ("ok","state","connected","visible","returncode","stdout","failure","transport","action") if k in r}
            if isinstance(r.get("state_json"),dict):
                mini["state_json"]={k:r["state_json"].get(k) for k in ("bluetooth_connected","audio_sink_present","audio_sink_default","state") if k in r["state_json"]}
        print(i,json.dumps(mini,separators=(",",":")))
