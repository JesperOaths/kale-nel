#!/usr/bin/env python3
from pathlib import Path
p=Path("/home/jespern/c720p-home-hub/logs/samsung-bluetooth-connect-20260926-171128.log")
print(p.read_text(errors="replace")[-24000:] if p.exists() else "MISSING")
print("RESULT=V878_PROVEN_LOG_READ")
