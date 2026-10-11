#!/usr/bin/env python3
"""Post-install read-only verification of Security V6; never changes media or services."""
import hashlib,json,pathlib,subprocess,shutil,urllib.request,urllib.error
ROOT=pathlib.Path("/opt/homeassistant/config/www")
pages={
 "security":("c720p-surveillance.html","c4fe28a6326b479328951df9106dffbe89ad292a75db2bdd40e843be49ee2a7b"),
 "recordings":("frontyard-security-new/clips.html","af99697af5a7264f4002328b12f1163f2256944ab51bfac51f8fe04f944b74cf"),
 "faces":("frontyard-security-new/face-appearances.html","71b0b925cc364a522833cc9ba8ceed3c713e20ff32c49c3d530f1830a1af74b2"),
 "archive":("c720p-drive-saved.html","37bb59d4d9834039bb3d26c2780786c7bd4e7d0ab3e7c62a0cf848cb307d6a28"),
}
out={"pages":{},"sd_index":{}}
for kind,(path,expected) in pages.items():
 f=ROOT/path
 actual=hashlib.sha256(f.read_bytes()).hexdigest()
 html=f.read_text(encoding="utf-8")
 checks={"hash":actual==expected,
         "v6_css":f'id="s9v6-{kind}-style"' in html,
         "v6_js":f'id="s9v6-{kind}-script"' in html,
         "original_document":html.count("</head>")==1 and html.count("</body>")==1}
 if kind=="security":
  checks["original_panels_preserved"]=all(s in html for s in ('id="panel-live"','id="panel-saved"','id="panel-faces"'))
  checks["legacy_shell_preserved"]='id="s9v5-command-script"' in html
 if kind=="recordings":
  checks["video_preserved"]='id="player"' in html
  checks["recordings_preserved"]='id="list"' in html
 if kind=="faces":
  checks["face_crop_signed_relay"]="/new/saved/face/" in html
 if kind=="archive":
  checks["date_fold_enabled"]="details.open=expanded" in html
 out["pages"][kind]=checks
 try:
  url="http://127.0.0.1:8123/local/"+path
  with urllib.request.urlopen(url,timeout=8) as r:
   served=r.read(2_000_000).decode("utf-8","replace")
   out["pages"][kind]["http_status"]=r.status
   out["pages"][kind]["served_v6"]=f'id="s9v6-{kind}-script"' in served
 except urllib.error.HTTPError as e:
  out["pages"][kind]["http_status"]=e.code
  out["pages"][kind]["served_v6"]="auth_required" if e.code in (401,403) else False
 except Exception as e:
  out["pages"][kind]["http_error"]=type(e).__name__
try:
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=18) as r: data=json.load(r)
 out["sd_index"]={"archive_mode":data.get("archive_mode"),"clips":len(data.get("events",[]))}
except Exception as e:out["sd_index"]={"error":type(e).__name__}
browser=shutil.which("chromium")
if browser:
 try:
  cmd=[browser,"--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
       "--disable-background-networking","--virtual-time-budget=3300","--dump-dom",
       (ROOT/"c720p-surveillance.html").resolve().as_uri()]
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=22)
  dom=p.stdout
  out["browser"]={"returncode":p.returncode,"shell_mounted":'id="s9v5-shell"' in dom,
      "overview_button_removed":'data-view="overview"' not in dom,
      "live_nav_present":'data-view="live"' in dom,
      "recordings_nav_present":'data-view="saved"' in dom}
 except Exception as e:out["browser"]={"error":type(e).__name__}
out["ok"]=all(all(value is True for key,value in checks.items() if key not in ("http_status","served_v6","http_error")) for checks in out["pages"].values()) and out["sd_index"].get("archive_mode")=="S9-microSD-only"
print("SECURITY_V6_POST_INSTALL",json.dumps(out,sort_keys=True),flush=True)
if not out["ok"]:raise SystemExit(6)
