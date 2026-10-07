#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.request

HOME = Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
WWW = Path("/opt/homeassistant/config/www")
SERVER = BASE / "bin/c720p-drive-security-archive.py"
UI = WWW / "c720p-drive-saved.html"
OUT = WWW / "c720p-saved-thumbs"
MAN = OUT / "manifest.json"
CFG = BASE / "config/drive-security-archive.json"
SERVICE = "c720p-saved-thumbnailer-v106.service"
TIMER = "c720p-saved-thumbnailer-v106.timer"
ARCHIVE_SERVICE = "c720p-drive-security-archive.service"
STAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK = HOME / "c720p-backups" / f"security-thumbnail-v111-{STAMP}"
BACK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

def backup(p: Path) -> None:
    if p.exists():
        shutil.copy2(p, BACK / (p.name + ".before"))

for p in (SERVER, UI, MAN,
          HOME / ".config/systemd/user/c720p-saved-thumbnailer-v106.service",
          HOME / ".config/systemd/user/c720p-saved-thumbnailer-v106.timer"):
    backup(p)

# Avoid a manifest race with the person-aware thumbnailer while repairing coverage.
subprocess.run(["systemctl", "--user", "stop", TIMER], check=False, timeout=20)
subprocess.run(["systemctl", "--user", "stop", SERVICE], check=False, timeout=30)

# 1) Repair the saved-media compatibility routes.
s = SERVER.read_text()
if "C720P_SAVED_MEDIA_COMPAT_V111" not in s:
    route_anchor = "  m=re.fullmatch(r'/(new|s3)/snap/([A-Za-z0-9._-]+)',p)\n"
    if route_anchor not in s:
        raise SystemExit("SERVER_SNAPSHOT_ROUTE_ANCHOR_MISSING")
    routes = r'''  # C720P_SAVED_MEDIA_COMPAT_V111
  m=re.fullmatch(r'/(new|s3)/saved/snap/([A-Za-z0-9._-]+)',p)
  if m:
   cam,n=m.groups(); n=safe(n)
   row=next((x for x in items(cam) if safe(x.get('snapshot_name'))==n),None)
   if not n or not row:self.js(404,{'ok':False,'error':'not_found'});return
   f=(TH/cam/n).resolve(); root=(TH/cam).resolve()
   if root in f.parents and f.is_file():self.local_file(f,'image/jpeg');return
   self.remote_snapshot(cam,n);return
  m=re.fullmatch(r'/(new|s3)/saved/clip/([A-Za-z0-9._-]+)',p)
  if m:
   cam,n=m.groups(); n=safe(n); row=lookup(cam,n)
   if not n or not row:self.js(404,{'ok':False,'error':'not_found'});return
   self.remote_file(cam,row);return
'''
    s = s.replace(route_anchor, routes + route_anchor, 1)

    method_anchor = " def remote_file(self,cam,row):\n"
    if method_anchor not in s:
        raise SystemExit("SERVER_REMOTE_FILE_ANCHOR_MISSING")
    method = r''' def remote_snapshot(self,cam,name):
  # Saved JPEGs are small enough to buffer. This gives the browser a normal
  # image response without keeping the full archive JPEG on the hub.
  c=cfg()
  cmd=[c['rclone'],'--config',c['rclone_config'],'cat',c['remote']+':'+name,
       '--drive-root-folder-id',str(c['folders'][cam]['id'])]
  try:r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=75)
  except Exception:self.js(503,{'ok':False,'error':'drive_snapshot_stream_failed'});return
  data=r.stdout or b''
  if r.returncode or len(data)<1000 or len(data)>8_000_000:
   try:names=remote_inventory(cam,True);missing=names is not None and name not in names
   except Exception:missing=False
   self.js(404 if missing else 503,{'ok':False,'error':'drive_snapshot_missing' if missing else 'drive_snapshot_stream_failed'});return
  self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','private, max-age=300');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
  if self.command!='HEAD':
   try:self.wfile.write(data)
   except (BrokenPipeError,ConnectionResetError):pass

'''
    s = s.replace(method_anchor, method + method_anchor, 1)
    SERVER.write_text(s)

r = subprocess.run(["python3", "-m", "py_compile", str(SERVER)], text=True, capture_output=True)
if r.returncode:
    raise SystemExit("SERVER_PY_COMPILE_FAILED:" + r.stderr[-1200:])

subprocess.run(["systemctl", "--user", "restart", ARCHIVE_SERVICE], check=True, timeout=40)
for _ in range(30):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8795/health.json", timeout=2) as resp:
            if resp.status == 200:
                break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("ARCHIVE_SERVICE_DID_NOT_RETURN")

# 2) Immediate low-cost thumbnail coverage from the JPEG already archived
# beside each verified MP4. V108 can upgrade these later.
cfg = json.loads(CFG.read_text())
with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t=" + str(time.time()), timeout=90) as resp:
    api = json.loads(resp.read().decode("utf-8"))
events = [x for x in api.get("events", []) if isinstance(x, dict) and x.get("remote_name")]

try:
    manifest = json.loads(MAN.read_text()) if MAN.exists() else {}
except Exception:
    manifest = {}
items = manifest.get("items", {}) if isinstance(manifest, dict) else {}
if not isinstance(items, dict):
    items = {}

def atomic_manifest() -> None:
    manifest["version"] = "v111-fast-fallback+v108-upgrade"
    manifest["generated_at"] = time.time()
    manifest["items"] = items
    q = MAN.with_suffix(".json.tmp-v111")
    q.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    os.replace(q, MAN)

def output_for(remote_name: str) -> Path:
    return OUT / (hashlib.sha1(remote_name.encode()).hexdigest()[:20] + ".jpg")

def valid_existing(remote_name: str) -> bool:
    rec = items.get(remote_name)
    if not isinstance(rec, dict):
        return False
    f = OUT / str(rec.get("file") or "")
    return f.is_file() and f.stat().st_size > 2500

missing_before = [e for e in events if not valid_existing(str(e.get("remote_name") or ""))]
generated = 0
failed = []
shm = Path("/dev/shm") if Path("/dev/shm").is_dir() else Path("/tmp")

for e in missing_before:
    remote_name = Path(str(e.get("remote_name") or "")).name
    snap_name = Path(str(e.get("snapshot_name") or "")).name
    if not remote_name or not snap_name or ".." in remote_name or ".." in snap_name:
        failed.append({"remote_name": remote_name, "reason": "invalid_name"})
        continue
    dst = output_for(remote_name)
    tmp_src = shm / ("c720p-v111-" + hashlib.sha1(snap_name.encode()).hexdigest()[:12] + ".jpg")
    tmp_dst = dst.with_suffix(".tmp-v111.jpg")
    for p in (tmp_src, tmp_dst):
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass
    cmd = [
        cfg["rclone"], "--config", cfg["rclone_config"],
        "copyto", cfg["remote"] + ":" + snap_name, str(tmp_src),
        "--drive-root-folder-id", str(cfg["folders"]["new"]["id"]),
        "--retries", "2", "--low-level-retries", "3",
    ]
    rr = subprocess.run(cmd, text=True, capture_output=True, timeout=90)
    if rr.returncode or not tmp_src.is_file() or tmp_src.stat().st_size < 1000:
        failed.append({"remote_name": remote_name, "reason": "drive_snapshot_fetch_failed"})
        try: tmp_src.unlink()
        except Exception: pass
        continue

    ff = subprocess.run([
        "/usr/bin/ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(tmp_src), "-frames:v", "1", "-vf", "scale=900:-2",
        "-q:v", "5", str(tmp_dst)
    ], text=True, capture_output=True, timeout=30)
    try: tmp_src.unlink()
    except Exception: pass
    if ff.returncode or not tmp_dst.is_file() or tmp_dst.stat().st_size < 2500:
        failed.append({"remote_name": remote_name, "reason": "preview_resize_failed"})
        try: tmp_dst.unlink()
        except Exception: pass
        continue

    os.replace(tmp_dst, dst)
    items[remote_name] = {
        "duration": None,
        "file": dst.name,
        "generated_at": time.time(),
        "model": "archived-drive-snapshot-v111",
        "panels": [],
        "person_status": str(e.get("person_status") or "unknown"),
        "primary_panel": 0,
        "primary_person_confidence": float(e.get("person_confidence") or 0),
        "primary_time": None,
        "sample_count": 0,
        "thumbnail_method": "archived-snapshot-fast",
        "url": "/local/c720p-saved-thumbs/" + dst.name,
        "version": "v111-fast",
    }
    generated += 1
    atomic_manifest()

atomic_manifest()

# 3) UI hardening.
u = UI.read_text()
if "C720P_SAVED_THUMB_REPAIR_V111" not in u:
    u = u.replace("</head>", '<meta name="c720p-saved-thumb-build" content="C720P_SAVED_THUMB_REPAIR_V111">\n</head>', 1)
    old = "const m=wrap.querySelector('.thumbUnavailable');if(m)m.textContent='Preview unavailable'};"
    new = "const m=wrap.querySelector('.thumbUnavailable');if(m)m.textContent='Preview unavailable';delete wrap.dataset.loaded};"
    if old in u:
        u = u.replace(old, new, 1)
    UI.write_text(u)

subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, timeout=20)
subprocess.run(["systemctl", "--user", "enable", "--now", TIMER], check=True, timeout=30)
subprocess.run(["systemctl", "--user", "restart", "c720p-home-hub-kiosk.service"], check=False, timeout=25)

# 4) Verification.
with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t=" + str(time.time()), timeout=90) as resp:
    final_api = json.loads(resp.read().decode("utf-8"))
final_events = [x for x in final_api.get("events", []) if isinstance(x, dict) and x.get("remote_name")]
final_manifest = json.loads(MAN.read_text())
final_items = final_manifest.get("items", {})

def covered(e: dict) -> bool:
    n = str(e.get("remote_name") or "")
    rec = final_items.get(n)
    if not isinstance(rec, dict):
        return False
    f = OUT / str(rec.get("file") or "")
    return f.is_file() and f.stat().st_size > 2500

exact = []
wanted = {22, 143, 134, 130, 124}
for e in final_events:
    try: no = int(e.get("clip_no"))
    except Exception: continue
    if no not in wanted: continue
    exact.append({
        "clip_no": no,
        "timestamp": e.get("timestamp"),
        "covered": covered(e),
        "snapshot_name": e.get("snapshot_name"),
        "version": (final_items.get(str(e.get("remote_name") or "")) or {}).get("version"),
    })

route_test = None
target = next((e for e in final_events if int(e.get("clip_no") or -1) == 143 and str(e.get("timestamp") or "").startswith("2026-09-25 23:55")), None)
if target and target.get("snapshot_name"):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8795/new/saved/snap/" + target["snapshot_name"], timeout=45) as resp:
            b = resp.read(64)
            route_test = {"status": resp.status, "content_type": resp.headers.get("Content-Type"), "first_bytes": len(b)}
    except Exception as exc:
        route_test = {"error": str(exc)}

coverage = sum(1 for e in final_events if covered(e))
disk_bytes = sum((OUT / str(v.get("file") or "")).stat().st_size
                 for v in final_items.values()
                 if isinstance(v, dict) and (OUT / str(v.get("file") or "")).is_file())

print(json.dumps({
    "ok": coverage == len(final_events) and route_test and route_test.get("status") == 200,
    "version": "v111",
    "backup": str(BACK),
    "saved_events": len(final_events),
    "coverage_before": len(events) - len(missing_before),
    "missing_before": len(missing_before),
    "fast_generated": generated,
    "backfill_failed": failed,
    "coverage_after": coverage,
    "coverage_missing_after": len(final_events) - coverage,
    "thumbnail_cache_mb": round(disk_bytes / 1024 / 1024, 2),
    "saved_snapshot_route": route_test,
    "screenshot_clip_checks": exact,
    "thumbnail_timer_active": subprocess.run(
        ["systemctl", "--user", "is-active", TIMER],
        text=True, capture_output=True
    ).stdout.strip(),
}, indent=2))
