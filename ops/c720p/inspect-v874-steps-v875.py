#!/usr/bin/env python3
import json,glob,pathlib,subprocess
base=pathlib.Path("/home/jespern/c720p-home-hub")
logs=sorted(glob.glob(str(base/"logs/tv-hts-v874-test-*.json")))
if logs:
 d=json.loads(pathlib.Path(logs[-1]).read_text())
 print("LOG",logs[-1])
 for key in ("start_tv","start_hts","start_bt","hts_safe","after_hts","after_bt","after_hts_tv","final_hts","final_bt","final_tv"):
  v=d.get(key,{})
  data=v.get("data") if isinstance(v,dict) else None
  print("KEY",key,"ok",v.get("ok") if isinstance(v,dict) else None,"status",v.get("status") if isinstance(v,dict) else None)
  if key=="hts_safe" and isinstance(data,dict):
   print("HTS_SAFE_STATE",data.get("state"),"failure",data.get("failure"),"hts_power",data.get("hts_power"),"hts_input",data.get("hts_input"))
   for i,s in enumerate(data.get("steps") or []):
    r=s.get("result")
    mini={"stage":s.get("stage"),"action":s.get("action"),"check":s.get("check"),"cycle":s.get("cycle")}
    if isinstance(r,dict):
     mini["result"]={k:r.get(k) for k in ("ok","state","power_state","present","connected","visible","transport","command","error","returncode","stdout") if k in r}
     if isinstance(r.get("result"),dict):
      mini["nested"]={k:r["result"].get(k) for k in ("ok","transport","command","target","state") if k in r["result"]}
    print("STEP",i,json.dumps(mini,separators=(",",":")))
  elif isinstance(data,dict):
   print(json.dumps({k:data.get(k) for k in ("state","power_state","present","connected","bluetooth_connected","audio_sink_present","audio_sink_default","error") if k in data},separators=(",",":")))
helper=base/"bin/c720p-bluetooth-helper-server.py"; server=base/"bin/ht-e6500-surround-server.py"
for label,cmd in [
 ("HELPER_PREPARE",f"sed -n '180,410p' {helper}"),
 ("SERVER_SENDIR",f"sed -n '320,415p' {server}"),
 ("SERVER_BTROUTES",f"sed -n '1160,1210p' {server}; sed -n '1350,1410p' {server}"),
 ("SERVER_SEQ",f"sed -n '600,650p' {server}")
]:
 print("===",label,"===")
 p=subprocess.run(["bash","-lc",cmd],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
 print((p.stdout or "")[-22000:])
