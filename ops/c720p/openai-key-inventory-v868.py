#!/usr/bin/env python3
from pathlib import Path
import hashlib, os, re

roots=[
 Path("/opt/inbox-triage-agent"),
 Path("/home/jespern/c720p-home-hub"),
 Path("/home/jespern/.config/systemd/user"),
 Path("/home/jespern/.config"),
]
skip_parts={".cache",".git","node_modules","browser","firefox","chromium","tokens","logs","__pycache__"}
pat=re.compile(rb"sk-[A-Za-z0-9_-]{20,220}")
seen={}
for root in roots:
    if not root.exists(): continue
    for p in root.rglob("*"):
        if not p.is_file(): continue
        if any(part in skip_parts for part in p.parts): continue
        try:
            if p.stat().st_size>2_000_000: continue
            b=p.read_bytes()
        except Exception:
            continue
        for m in pat.findall(b):
            fp=hashlib.sha256(m).hexdigest()[:12]
            seen.setdefault(fp,[]).append(str(p))
print("CANDIDATE_KEY_COUNT="+str(len(seen)))
for idx,(fp,paths) in enumerate(sorted(seen.items()),1):
    print(f"KEY_{idx}_FINGERPRINT={fp}")
    print(f"KEY_{idx}_LOCATIONS="+repr(sorted(set(paths))[:20]))
print("RESULT=OPENAI_KEY_INVENTORY_V868_DONE")
