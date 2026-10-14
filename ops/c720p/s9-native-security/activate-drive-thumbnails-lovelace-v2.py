#!/usr/bin/env python3
"""Bump active Home Assistant Security view URL to patched thumbnail interface.

Guard exact prior URL and view, backup entire dashboard document, preserve
other views/cards, restart only the HA container to reload storage-based
Lovelace config, verify newly versioned iframe URL and HA health. Does not
touch media, S9 camera, or Wyoming containers.
"""
from __future__ import annotations
import datetime,json,subprocess,time,sys
FILE="/config/.storage/lovelace.c720p_hub"
EXPECTED="/local/c720p-surveillance.html?v=archive-review-v32-20261014"
NEW="/local/c720p-surveillance.html?v=drive-thumb-mount-v2-20261014"
def run(args,timeout=30):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode!=0:raise RuntimeError("command_failed_"+str(args[:3])+":"+p.stderr[-500:])
 return p.stdout
STAGE=r'''
import datetime,json,os,pathlib,shutil
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
if not p.is_file() or p.is_symlink():raise RuntimeError("storage_document_unavailable")
raw=p.read_bytes(); d=json.loads(raw)
views=d.get("data",{}).get("config",{}).get("views",[])
found=[v for v in views if v.get("path")=="front-yard-security"]
if len(found)!=1:raise RuntimeError("security_view_not_unique")
cards=found[0].get("cards",[])
matches=[c for c in cards if c.get("type")=="iframe"]
if len(matches)!=1:raise RuntimeError("security_iframe_not_unique")
old="/local/c720p-surveillance.html?v=archive-review-v32-20261014"
new="/local/c720p-surveillance.html?v=drive-thumb-mount-v2-20261014"
val=matches[0].get("url")
if val==new:
 print(json.dumps({"already":True,"current":val,"changed":False}))
 raise SystemExit(0)
if val!=old:raise RuntimeError("security_dashboard_url_changed_unexpectedly")
stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup=p.with_name("lovelace.c720p_hub.before-drive-thumb-v2-"+stamp)
with backup.open("xb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
backup.chmod(0o600)
matches[0]["url"]=new
new_raw=json.dumps(d,ensure_ascii=False,separators=(",",":")).encode("utf-8")
tmp=p.with_name(".lovelace.c720p_hub.drive-thumbs-v2.tmp")
try:
 with tmp.open("wb") as f:f.write(new_raw);f.flush();os.fsync(f.fileno())
 tmp.chmod(p.stat().st_mode & 0o777)
 os.replace(tmp,p)
 if json.loads(p.read_bytes())!=d:raise RuntimeError("dashboard_readback_mismatch")
except Exception:
 p.write_bytes(raw);tmp.unlink(missing_ok=True)
 raise
print(json.dumps({"updated":True,"backup":str(backup),"current":new,
 "only_url_field_changed":True,"other_cards_preserved":True}))
'''
CHECK=r'''
import json,pathlib
p=pathlib.Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_bytes())
v=[x for x in d["data"]["config"]["views"] if x.get("path")=="front-yard-security"]
assert len(v)==1
u=v[0]["cards"][0]["url"]
assert u=="/local/c720p-surveillance.html?v=drive-thumb-mount-v2-20261014",u
print("ACTIVE_SECURITY_DASHBOARD_CACHE_BUST_OK",u)
'''
def main():
 prev=run(["docker","ps","--filter","name=^/homeassistant$","--format","{{.Status}}"]).strip()
 if not prev.startswith("Up "):raise RuntimeError("homeassistant_not_running_before_change")
 result=json.loads(run(["docker","exec","homeassistant","python3","-c",STAGE],timeout=25))
 print("DASHBOARD_STAGE",json.dumps(result,sort_keys=True),flush=True)
 if result.get("already") is not True:
  run(["docker","restart","homeassistant"],timeout=65)
  ok=False
  for _ in range(65):
   try:
    p=subprocess.run(["curl","-s","-o","/dev/null","-w","%{http_code}","--max-time","3",
                      "http://127.0.0.1:8123/"],capture_output=True,text=True,timeout=6)
    if p.returncode==0 and p.stdout.strip() in ("200","302","401"):ok=True;break
   except Exception:pass
   time.sleep(1)
  if not ok:raise RuntimeError("homeassistant_health_check_failed_after_restart")
 print(run(["docker","exec","homeassistant","python3","-c",CHECK],timeout=15).strip())
 live=run(["docker","ps","--format","{{.Names}}"],timeout=10).splitlines()
 required={"homeassistant","wyoming-vosk-fast","wyoming-vosk-wake","wyoming-whisper","wyoming-stt-router","wyoming-piper"}
 if not required.issubset(set(live)):raise RuntimeError("production_container_missing_after_restart")
 print(json.dumps({"ok":True,"version":"DRIVE_THUMB_LOVELACE_CACHE_BUST_V2",
   "updated":bool(result.get("updated")),"ha_health":True,
   "all_six_containers_running":True,"s9_recordings_modified":False,
   "historical_drive_recordings_modified":False},sort_keys=True))
 return 0
if __name__=="__main__":sys.exit(main())
