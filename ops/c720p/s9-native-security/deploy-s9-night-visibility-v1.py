#!/usr/bin/env python3
"""Guarded install of digital S9 live-night visibility controls on HA only.

Adds only one same-origin JavaScript file and one HTML <script> reference.
Does not touch the Android APK, recordings, camera control relays, storage,
motion detection, MJPEG transport, security authentication, or other tabs.
"""
import argparse
from datetime import datetime,timezone
import hashlib,json,os,re,stat,tempfile,urllib.request
from pathlib import Path

WWW=Path("/opt/homeassistant/config/www")
PAGE=WWW/"c720p-surveillance.html"
JS=WWW/"frontyard-security-new/s9-night-visibility-v1.js"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-night-visibility-v1")
MARKER='id="s9-night-visibility-v1"'
URLBASE="https://raw.githubusercontent.com/JesperOaths/kale-nel"
GITHUB_SOURCE="ops/c720p/s9-native-security/s9-night-visibility-v1.js"

def digest(data:bytes)->str:return hashlib.sha256(data).hexdigest()

def status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:
  return json.loads(r.read(100000))

def cameras():
 with urllib.request.urlopen("http://127.0.0.1:8794/new/camera-controls",timeout=12) as r:
  j=json.loads(r.read(200000))
 if not j.get("ok") or not isinstance(j.get("night_active"),bool):
  raise RuntimeError("authenticated_night_control_status_missing")
 return j

def archive():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as r:
  raw=r.read(2000001)
 if len(raw)>2000000:raise RuntimeError("archive_metadata_limit_exceeded")
 j=json.loads(raw)
 if j.get("archive_mode")!="S9-microSD-only" or not isinstance(j.get("events"),list):
  raise RuntimeError("verified_microSD_archive_unavailable")
 return len(j["events"])

def patch(html:str,rev:str)->str:
 if html.count("</body>")!=1 or html.count('id="cameraLive"')!=1:
  raise RuntimeError("unknown_home_assistant_live_page")
 if "/local/c720p-secure-relay-client.js" not in html:
  raise RuntimeError("authenticated_relay_client_missing")
 if "/local/frontyard-security-new/security-hub-v30.js" not in html:
  raise RuntimeError("unexpected_HA_security_version")
 script='<script '+MARKER+' src="/local/frontyard-security-new/s9-night-visibility-v1.js?v='+rev[:12]+'"></script>'
 if MARKER in html:
  regex=r'<script\s+id="s9-night-visibility-v1"[^>]*></script>'
  if len(re.findall(regex,html))!=1:raise RuntimeError("unknown_existing_night_script")
  return re.sub(regex,script,html,count=1)
 return html.replace("</body>",script+"\n</body>",1)

def atomic(path:Path,body:bytes,mode:int):
 fd,temp=tempfile.mkstemp(prefix=".s9-night-view-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(body);f.flush();os.fsync(f.fileno())
  os.chmod(temp,mode)
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)

def main():
 cli=argparse.ArgumentParser()
 cli.add_argument("--ref",required=True)
 cli.add_argument("--js-sha",required=True)
 args=cli.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",args.ref) or not re.fullmatch(r"[a-f0-9]{64}",args.js_sha):
  raise RuntimeError("immutable_source_identity_required")
 original_status=status()
 if not original_status.get("ok") or original_status.get("mode")!="watching" or (
    not original_status.get("native_4k_enabled") or
    not original_status.get("continuous_4k_ready") or
    original_status.get("night_mode")!="auto"):
  raise RuntimeError("native_camera_not_ready_no_UI_changes")
 cameras()
 previous_count=archive()
 if not PAGE.is_file() or PAGE.is_symlink():
  raise RuntimeError("live_page_missing_or_symlinked")
 if not JS.parent.is_dir() or JS.parent.is_symlink() or JS.is_symlink():
  raise RuntimeError("UI_assets_directory_or_target_invalid")
 current=PAGE.read_bytes()
 if len(current)>50000:raise RuntimeError("unexpected_main_page_size")
 revised=patch(current.decode("utf-8"),args.ref).encode("utf-8")
 url=URLBASE+"/"+args.ref+"/"+GITHUB_SOURCE
 with urllib.request.urlopen(url,timeout=35) as response:
  js=response.read(30001)
 if len(js)>30000 or digest(js)!=args.js_sha or (
    b"S9_NIGHT_VISIBILITY_V1" not in js or b"/new/camera-controls" not in js):
  raise RuntimeError("night_view_asset_checksum_or_shape_invalid")
 # Full backup completed BEFORE any write, never relying on an APK rollback.
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 saved={}
 for p in (PAGE,JS):
  prior=p.read_bytes() if p.is_file() and not p.is_symlink() else None
  saved[p]=prior
  if prior is not None:
   backup=BACKUP/(stamp+"-"+p.name)
   if backup.exists():raise RuntimeError("backup_collision")
   backup.write_bytes(prior);os.chmod(backup,0o600)
   if digest(backup.read_bytes())!=digest(prior):
    raise RuntimeError("backup_checksum_mismatch")
 changed=[]
 try:
  if saved[JS]!=js:
   atomic(JS,js,stat.S_IMODE(JS.stat().st_mode) if JS.is_file() else 0o644)
   changed.append(JS)
  if saved[PAGE]!=revised:
   if PAGE.read_bytes()!=current:raise RuntimeError("concurrent_HA_edit")
   atomic(PAGE,revised,stat.S_IMODE(PAGE.stat().st_mode))
   changed.append(PAGE)
  if PAGE.read_bytes()!=revised or JS.read_bytes()!=js:
   raise RuntimeError("UI_file_written_checksum_mismatch")
  after=status()
  if not after.get("ok") or not after.get("continuous_4k_ready"):
   raise RuntimeError("4k_camera_health_changed")
  cams=cameras()
  now=archive()
  if now<previous_count:raise RuntimeError("saved_clips_missing_after_display_patch")
  print("S9_NIGHT_VISIBILITY_V1_APPLIED "+json.dumps({
    "changed":[p.name for p in changed],
    "display_only":True,"raw_video_unchanged":True,
    "signed_relay_unchanged":True,"night_mode":after.get("night_mode"),
    "night_active":cams["night_active"],
    "original_archive_count":previous_count,"archive_after":now,
    "4k_ready":after.get("continuous_4k_ready"),
    "ui_js_sha256":digest(js),
    "backup_stamp":stamp},sort_keys=True),flush=True)
 except BaseException:
  for p in reversed(changed):
   try:
    old=saved[p]
    if old is None:p.unlink(missing_ok=True)
    else:atomic(p,old,stat.S_IMODE(p.stat().st_mode))
   except Exception:print("S9_NIGHT_VISIBILITY_RESTORE_ERROR_"+p.name,flush=True)
  print("S9_NIGHT_VISIBILITY_V1_ROLLBACK_ATTEMPTED",flush=True)
  raise

if __name__=="__main__":
 main()
