#!/usr/bin/env python3
"""Read-only live checks for Security V7."""
from pathlib import Path
import urllib.request,json,hashlib,subprocess,shutil,re
ROOT=Path("/opt/homeassistant/config/www")
pages={
 "security":("c720p-surveillance.html","s9v7-root-script"),
 "recordings":("frontyard-security-new/clips.html","s9v7-recordings-scroll-style"),
 "archive":("frontyard-security-new/security-archive-v7.html","s9v7-archive-script"),
 "tracks":("frontyard-security-new/security-tracks-v7.html","s9v7-tracks-script"),
}
out={"pages":{}}
for kind,(path,marker) in pages.items():
 p=ROOT/path
 html=p.read_text(encoding="utf-8")
 with urllib.request.urlopen("http://127.0.0.1:8123/local/"+path,timeout=10) as resp:
  content=resp.read(2000000).decode("utf-8","replace")
  out["pages"][kind]={"status":resp.status,"marker":marker in content,"matches_disk":content==html,
     "bytes":len(content),"sha256":hashlib.sha256(html.encode()).hexdigest()}
  assert resp.status==200 and marker in content and html==content
assert 'id="s9-anonymous-clips-script-v1"' not in (ROOT/pages["recordings"][0]).read_text()
with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as r:
 j=json.load(r)
out["sd"]={"mode":j.get("archive_mode"),"clips":len(j.get("events",[])),
 "track_indexed":sum(1 for e in j.get("events",[]) if e.get("anonymous_tracking_status")=="sampled_tracks_available"),
 "date_examples":list({e.get("clip_no","")[:13] for e in j.get("events",[])})[:4]}
assert out["sd"]["mode"]=="S9-microSD-only"
browser=shutil.which("chromium")
if browser:
 try:
  cmd=[browser,"--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
       "--disable-background-networking","--virtual-time-budget=2200","--dump-dom",
       (ROOT/pages["security"][0]).resolve().as_uri()]
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=16)
  # Parse visible button tags, not strings embedded in <script> sources.
  dom=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',p.stdout,flags=re.I)
  out["browser"]={"exit":p.returncode,"tracks_tab":bool(re.search(r'<button[^>]*data-view="tracks"',dom)),
     "overview_hidden":bool(re.search(r's9v7-root-style',p.stdout)),"tracks_frame":'id="s9v7-tracks-frame"' in dom}
 except Exception as e:out["browser"]={"warning":type(e).__name__}
print("SECURITY_V7_LIVE_READBACK",json.dumps(out,sort_keys=True),flush=True)
