#!/usr/bin/env python3
"""Read-only S9+ camera live loop diagnosis. No raw images, tokens or credentials in logs."""
from pathlib import Path
import hashlib,re,json,time,urllib.request,urllib.error
PAGE=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
html=PAGE.read_text()
keys=["function tab(","function streams(on)","function s9LiveRetry(","function s9StartFetchFallback(","function s9FetchMjpeg(","function s9ShowFetchedFrame(","function stopImg(","s9v7-root-script","s9v6-security-script"]
out={"html_bytes":len(html),"hooks":{},"endpoints":{}}
for key in keys:
 at=html.find(key);out["hooks"][key]={"found":at>=0,"count":html.count(key)}
 if at>=0 and key.startswith("function "):
  out["hooks"][key]["body_snippet"]=re.sub(r"\s+"," ",html[at:at+1100])[:1000]
patterns=["streams(true)","streams(false)","s9LiveRetry(","s9StartFetchFallback(","document.visibilityState","document.hidden","setInterval(","setTimeout(","s9LiveStop()"]
out["call_counts"]={p:html.count(p) for p in patterns}
def request(url):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"Cache-Control":"no-cache"}),timeout=9) as response:
   t=response.headers.get("Content-Type","")
   b=response.read(240000 if "image/" in t else 15000)
   return {"status":response.status,"type":t,"bytes":len(b),
           "digest":hashlib.sha256(b).hexdigest()[:16] if "image/" in t else None,
           "json":({k:v for k,v in json.loads(b).items() if k in
              ("version","mode","camera_mode","camera_enabled","native_4k_enabled","frames","snapshot_ready","watching","recording","preview_fps","snapshot_fps","temperature_c","fps","camera_sensor","last_jpeg_age_s")}
             if "json" in t.lower() else None)}
 except Exception as e:return {"error":type(e).__name__}
for u in ["http://127.0.0.1:18808/status","http://127.0.0.1:8795/new/api/live-person-watch",
          "http://127.0.0.1:18808/shot.jpg","http://127.0.0.1:8795/new/live.jpg",
          "http://127.0.0.1:8795/new/live.mjpg"]:
 if "mjpg" in u:
  # MJPEG is intentionally long-lived; just test response headers, do not hang on frame reads.
  try:
   with urllib.request.urlopen(u,timeout=5) as r:
    out["endpoints"][u]={"status":r.status,"type":r.headers.get("Content-Type","")}
  except Exception as e:out["endpoints"][u]={"error":type(e).__name__}
 else:
  out["endpoints"][u]=[request(u)]
  if "shot.jpg" in u or "live.jpg" in u:
   time.sleep(2.0);out["endpoints"][u].append(request(u))
print("LIVE_DIAG",json.dumps(out,sort_keys=True),flush=True)
