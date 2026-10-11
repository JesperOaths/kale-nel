#!/usr/bin/env python3
"""Inspect installed live-player logic only; no sessions/media/logged credentials."""
from pathlib import Path
import re,json
p=Path("/opt/homeassistant/config/www/security-video-playback.js")
s=p.read_text()
out={"size":len(s),"functions":{}}
for m in re.finditer(r'(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',s):
 name=m.group(1)
 if ("live" in name.lower() or "start" in name.lower() or "frame" in name.lower() or "stop" in name.lower()
     or "health" in name.lower() or "blob" in name.lower() or "mjpeg" in name.lower() or "poll" in name.lower() or "fetch" in name.lower()):
  out["functions"][name]={"location":m.start(),"code":s[m.start():m.start()+3700]}
for needle in ['startLive(img','window.C720PSecurityVideo','setInterval(','new MediaSource','playbackRate','currentTime','video.loop','retry','location.href','maxFrames','live.mjpg']:
 out["functions"]["token:"+needle]={"index":s.find(needle),"context":s[max(0,s.find(needle)-150):s.find(needle)+900] if s.find(needle)>=0 else ''}
print("SMOOTH_VIDEO_PLAYER",json.dumps(out,sort_keys=True),flush=True)
