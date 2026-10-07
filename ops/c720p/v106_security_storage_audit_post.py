#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, urllib.request, time

AUDIT_URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/c18ac2e2e1f3e9069c9fbaf339cdd8be34488c51/ops/c720p/v106_security_storage_audit.py"
AUDIT=pathlib.Path("/tmp/v106_security_storage_audit.py")
OUT=pathlib.Path("/tmp/v106_security_storage_audit.json")

AUDIT.write_bytes(urllib.request.urlopen(AUDIT_URL,timeout=30).read())
r=subprocess.run(["python3",str(AUDIT)],text=True,capture_output=True,timeout=180)
if r.returncode:
    raise SystemExit("audit failed: "+r.stderr[-2000:])
OUT.write_text(r.stdout,encoding="utf-8")
d=json.loads(r.stdout)
summary={
 "at":d.get("at"),"disk":d.get("disk"),"local":d.get("local"),"drive":d.get("drive"),
 "saved_api":d.get("saved_api"),"units":d.get("units"),"tools":d.get("tools"),
 "drive_config":d.get("drive_config"),"person_index_sample":d.get("person_index_sample"),
 "files":d.get("files")
}
raw=json.dumps(summary,separators=(",",":"),default=str)
if len(raw)>44000:
    summary["person_index_sample"]=summary.get("person_index_sample",[])[:6]
    for k in ("trim","drive_retention","archive_server","saved_ui"):
        if isinstance(summary.get("files",{}).get(k),dict):
            summary["files"][k]["hits"]=summary["files"][k].get("hits",[])[:70]
    raw=json.dumps(summary,separators=(",",":"),default=str)
token=pathlib.Path("/home/jespern/.config/c720p-agent/security-token").read_text().strip()
req=urllib.request.Request(
    "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/ops-c720p-diag-ingest-v1",
    data=raw.encode(),method="POST",
    headers={"content-type":"application/json","x-c720p-token":token},
)
with urllib.request.urlopen(req,timeout=30) as resp:
    print("DIAG_POST",resp.status)
print("RESULT=V106_SECURITY_STORAGE_AUDIT_POSTED")
