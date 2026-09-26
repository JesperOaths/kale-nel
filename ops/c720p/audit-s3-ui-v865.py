#!/usr/bin/env python3
from pathlib import Path
import re
roots=[Path("/opt/homeassistant/config"),Path("/home/jespern/c720p-home-hub")]
pat=re.compile(r"(S3 camera|s3-clips|s3-saved|camera\.s3|/security/s3|camera=s3)",re.I)
ext={".html",".js",".yaml",".yml",".json",".py",".md"}
hits=[]
for root in roots:
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in ext:continue
        if any(x in p.parts for x in ("logs","state","node_modules",".git","backups")):continue
        try:
            for i,line in enumerate(p.read_text(errors="ignore").splitlines(),1):
                if pat.search(line):
                    hits.append({"file":str(p),"line":i,"text":line.strip()[:600]})
                    if len(hits)>=250:break
        except Exception:pass
        if len(hits)>=250:break
    if len(hits)>=250:break
import json
print(json.dumps(hits,separators=(",",":")))
