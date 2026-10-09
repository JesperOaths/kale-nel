#!/usr/bin/env python3
"""Fix C720P Google Photos slideshow's stale hard-coded 60 image counter.
Keep the count tied to the actual PHOTOS list during every future sync.
Back up touched files; preserve original permissions and HTML framing logic.
"""
from __future__ import annotations
import datetime, json, pathlib, re, shutil, subprocess, sys, time
WWW=pathlib.Path("/opt/homeassistant/config/www")
PHOTO=WWW/"c720p-google-photos-inner-security.html"
WRAP=WWW/"c720p-release/home-live-primary-v2.html"
MAN=WWW/"c720p-google-photos-album/manifest.json"
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
src=PHOTO.read_text(encoding="utf-8")
wsrc=WRAP.read_text(encoding="utf-8")
m=re.search(r'const PHOTOS=(\[.*?\]);',src,re.S)
if not m:raise SystemExit("PHOTOS array missing; refuse unknown slideshow")
photos=json.loads(m.group(1))
manifest=json.loads(MAN.read_text())
eligible={x["src"] if isinstance(x,dict) else x for x in manifest.get("photos",[])}
missing=[p for p in photos if p not in eligible or not (WWW/p.removeprefix("/local/")).is_file()]
if missing:raise SystemExit("Manifest / disk mismatch: "+repr(missing[:5]))
if len(set(photos))!=len(photos):raise SystemExit("Duplicate photo paths in slideshow")
if len(photos)<60:raise SystemExit("Unexpected photo count "+str(len(photos)))
old_counter='<div id="counter" class="counter">0 / 60</div>'
new_counter='<div id="counter" class="counter">0 / …</div>'
if src.count(old_counter)==1:
    src=src.replace(old_counter,new_counter,1)
elif new_counter not in src:
    raise SystemExit("Unexpected counter markup")
if 'const TOTAL=60;' in src:
    if src.count("const TOTAL=60;")!=1:raise SystemExit("Multiple TOTAL constants")
    src=src.replace("const TOTAL=60;","const TOTAL=PHOTOS.length;",1)
elif "const TOTAL=PHOTOS.length;" not in src:
    raise SystemExit("Unrecognized slideshow total")
old='''    shown++;
    counter.textContent=shown+" / "+TOTAL;
'''
new='''    shown++;
    // Count is always derived from the current album. Wrap per full pass
    // rather than showing 93 / 92 when the next shuffled pass begins.
    counter.textContent=((shown-1)%TOTAL+1)+" / "+TOTAL;
'''
if old in src:
    src=src.replace(old,new,1)
elif new not in src:
    raise SystemExit("Unexpected slideshow counter update")
needle='''  const counter=document.getElementById("counter");
  const loading=document.getElementById("loading");
'''
replacement='''  const counter=document.getElementById("counter");
  counter.textContent="0 / "+TOTAL;
  const loading=document.getElementById("loading");
'''
if needle in src:
    src=src.replace(needle,replacement,1)
elif replacement not in src:
    raise SystemExit("Counter initialization missing")
old_url=re.search(r'/local/c720p-google-photos-inner-security\.html\?v=[^"]+',wsrc)
if not old_url:raise SystemExit("Wrapper iframe URL not found")
new_url='/local/c720p-google-photos-inner-security.html?v=PHOTO_COUNT_DYNAMIC_'+stamp
wsrc=wsrc[:old_url.start()]+new_url+wsrc[old_url.end():]
# Verify the actual manifest and slideshow agree before touching files.
assert len(photos)==len(eligible)
assert src.count("const TOTAL=PHOTOS.length;")==1
assert src.count("const TOTAL=60;")==0
if "--dry-run" in sys.argv:
    print(json.dumps({"ok":True,"dry_run":True,"slideshow":len(photos),
                      "manifest":len(eligible),"counter_dynamic":True,
                      "reload_needed":True}))
    sys.exit(0)
BACK=pathlib.Path("/home/jespern/c720p-backups")/("photo-dynamic-counter-"+stamp)
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(PHOTO,BACK/(PHOTO.name+".before"))
shutil.copy2(WRAP,BACK/(WRAP.name+".before"))
mode={p:p.stat().st_mode for p in [PHOTO,WRAP]}
try:
    for path,content in [(PHOTO,src),(WRAP,wsrc)]:
        path.chmod(0o644)
        path.write_text(content,encoding="utf-8")
        path.chmod(mode[path])
    # This restart reloads the nested iframes without restarting Home Assistant.
    res=subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],
                       capture_output=True,text=True,timeout=35)
    if res.returncode:raise RuntimeError("Kiosk restart failed: "+res.stderr[-800:])
    res=subprocess.run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],
                       capture_output=True,text=True,timeout=15)
    if res.stdout.strip()!="active":raise RuntimeError("Kiosk inactive")
    import urllib.request
    u="http://127.0.0.1:8123/local/c720p-google-photos-inner-security.html?v="+stamp
    with urllib.request.urlopen(u,timeout=10) as rsp:served=rsp.read().decode("utf-8")
    assert 'const TOTAL=PHOTOS.length;' in served
    assert 'counter.textContent="0 / "+TOTAL' in served
    assert new_url in WRAP.read_text()
    print(json.dumps({"ok":True,"slideshow_total":len(photos),"manifest_total":len(eligible),
                      "dynamic_counter":True,"counter_wraps":True,"cache_busted":True,
                      "kiosk":"active","served_html_verified":True,
                      "backup":str(BACK)},indent=2))
except BaseException:
    for path in [PHOTO,WRAP]:
        shutil.copy2(BACK/(path.name+".before"),path)
    subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],
                   capture_output=True,text=True,timeout=35)
    raise
