#!/usr/bin/env python3
"""Read-only live UI controller provenance and rendering diagnostics."""
from pathlib import Path
import re,json,urllib.request
p=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
html=p.read_text()
sources=re.findall(r'<script[^>]*\bsrc=["\x27]([^"\x27]+)',html)
out={"script_sources":sources,"snippets":{}}
for needle in ("C720P_SECURITY_SMOOTH_LIVE_BRIDGE_V1","securityRouteActive()","function tab(t)","C720PSecurityVideo","S9_LIVE_PHONE_8FPS_DISPLAY_V2","window.addEventListener('pageshow'","setInterval("):
 at=html.find(needle)
 out["snippets"][needle]=(html[max(0,at-180):at+1700] if at>=0 else "ABSENT")
for link in sources:
 if "security" not in link and "live" not in link and "video" not in link:continue
 file=link.split("?")[0].replace("/local/","")
 f=Path("/opt/homeassistant/config/www")/file
 if f.is_file():
  text=f.read_text(encoding="utf8",errors="replace")
  out["snippets"]["source:"+link]={"size":len(text),"codes":{key:text.find(key) for key in ["startLive","stopLive","shot.jpg","live.mjpg","setInterval","setTimeout","retry","pause","ObjectURL"]},
  "excerpt":text[:4800]}
print("LIVE_CONTROLLER",json.dumps(out,sort_keys=True),flush=True)
