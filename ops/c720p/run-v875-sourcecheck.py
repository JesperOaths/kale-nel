#!/usr/bin/env python3
import json, pathlib, subprocess, time, urllib.request

def run(cmd, timeout=20):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    return (p.stdout or "")[-12000:]

out=[]
out.append("===APP_SOURCE_INPUT===\n"+run(["bash","-lc","grep -n 'CODES.put(\"source_input\"' /home/jespern/s5-ir-bridge-manual/src/com/bruis/s5irbridge/IrReceiver.java || true"]))
out.append("===SERVER_SOURCE_INPUT===\n"+run(["bash","-lc","grep -n -A 12 -B 12 -E 'source_input|/ht-e6500/source|function-fast' /home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py | head -260"]))
out.append("===HELPER_OLD_SOURCE_INPUT===\n"+run(["bash","-lc","grep -n -A 55 -B 40 'source_input' /home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py.backup-tvfast-v4-20260926-180129 | head -260"]))
text="\n".join(out)
print(text)
try:
    token=pathlib.Path("/home/jespern/.config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"maintenance":{"v875_sourcecheck":{"ok":True,"output":text[-30000:]}}}
    req=urllib.request.Request("https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",data=json.dumps(payload,separators=(",",":")).encode(),method="POST",headers={"content-type":"application/json","x-c720p-token":token})
    urllib.request.urlopen(req,timeout=15).read()
except Exception as e:
    print("HEALTH_POST_ERR",repr(e))
