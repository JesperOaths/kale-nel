#!/usr/bin/env python3
"""Guarded installation of optional S9 recorded-video viewing enhancement.

Changes only clips.html and an adjacent JS asset in Home Assistant www.
Never edits saved MP4s, thumbnails, on-phone settings, ADB, detection or relay.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,re,stat,tempfile,urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
PAGE=ROOT/"clips.html"
JS=ROOT/"s9-recording-night-view-v1.js"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-recording-night-view-v1")
MARKER='id="s9-recording-night-script-v1"'
SOURCE="ops/c720p/s9-native-security/s9-recording-night-view-v1.js"

def sha(data):return hashlib.sha256(data).hexdigest()

def read_json(port,path,limit=200000):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=14) as r:
  data=r.read(limit+1)
 if len(data)>limit:raise RuntimeError("metadata_too_large")
 return json.loads(data)

def archive():
 result=read_json(8795,"/new/api/saved",2000000)
 if not result.get("archive_mode")=="S9-microSD-only" or not isinstance(result.get("events"),list):
  raise RuntimeError("source_archive_not_healthy")
 return len(result["events"])

def patch(src,ref):
 if src.count("</body>")!=1 or src.count('id="player"')!=1 or (
    "/local/security-video-playback.js" not in src or
    "/local/c720p-secure-relay-client.js" not in src):
  raise RuntimeError("unexpected_recording_player_page")
 tag='<script '+MARKER+' src="/local/frontyard-security-new/s9-recording-night-view-v1.js?v='+ref[:12]+'"></script>'
 if MARKER in src:
  pattern=r'<script\s+id="s9-recording-night-script-v1"[^>]*></script>'
  if len(re.findall(pattern,src))!=1:raise RuntimeError("bad_existing_script_tag")
  return re.sub(pattern,tag,src,count=1)
 return src.replace("</body>",tag+"\n</body>",1)

def atomic(path,payload,mode):
 fd,name=tempfile.mkstemp(prefix=".s9-clip-night-",dir=str(path.parent))
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(payload);f.flush();os.fsync(f.fileno())
  os.chmod(name,mode)
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)

def main():
 args=argparse.ArgumentParser()
 args.add_argument("--ref",required=True)
 args.add_argument("--js-sha",required=True)
 v=args.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",v.ref) or not re.fullmatch(r"[a-f0-9]{64}",v.js_sha):
  raise RuntimeError("source_ref_and_js_digest_required")
 if not ROOT.is_dir() or ROOT.is_symlink() or not PAGE.is_file() or PAGE.is_symlink() or JS.is_symlink():
  raise RuntimeError("unexpected_ui_assets")
 camera=read_json(18808,"/status")
 if not camera.get("ok") or not camera.get("continuous_4k_ready") or not camera.get("native_4k_enabled"):
  raise RuntimeError("native_4k_not_healthy_no_changes")
 before=archive()
 prior_page=PAGE.read_bytes()
 if len(prior_page)>190000:raise RuntimeError("unknown_recorded_page_length")
 revised=patch(prior_page.decode("utf-8"),v.ref).encode("utf-8")
 url="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+v.ref+"/"+SOURCE
 with urllib.request.urlopen(url,timeout=35) as r:
  new_js=r.read(30001)
 if len(new_js)>30000 or sha(new_js)!=v.js_sha or (
     b"S9_RECORDING_NIGHT_VIEW_V1" not in new_js or
     b"loadedmetadata" not in new_js or b"style.filter" not in new_js):
  raise RuntimeError("invalid_checksum_or_recorded_viewer_source")
 prior_js=JS.read_bytes() if JS.is_file() else None
 originals={PAGE:prior_page,JS:prior_js}
 targets={PAGE:revised,JS:new_js}
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 for path,payload in originals.items():
  if payload is None:continue
  dest=BACKUP/(stamp+"-"+path.name)
  if dest.exists():raise RuntimeError("backup_destination_exists")
  dest.write_bytes(payload);os.chmod(dest,0o600)
  if sha(dest.read_bytes())!=sha(payload):raise RuntimeError("backup_corrupt")
 changed=[]
 try:
  for path in (JS,PAGE):
   old=originals[path]
   if old==targets[path]:continue
   if path.is_file() and path.read_bytes()!=old:
    raise RuntimeError("concurrent_ui_change")
   atomic(path,targets[path],stat.S_IMODE(path.stat().st_mode) if path.is_file() else 0o644)
   changed.append(path)
  if JS.read_bytes()!=new_js or PAGE.read_bytes()!=revised:
   raise RuntimeError("postwrite_checksum_mismatch")
  after=archive()
  healthy=read_json(18808,"/status")
  if after<before or not healthy.get("ok") or not healthy.get("continuous_4k_ready"):
   raise RuntimeError("camera_or_archive_health_regression")
  print("S9_RECORDED_NIGHT_VIEW_V1_VERIFIED "+json.dumps({
    "changed_files":[p.name for p in changed],
    "new_video_decoder":False,"evidence_mutations":False,
    "existing_mp4_player_preserved":True,"video_starts_original":True,
    "archive_before":before,"archive_after":after,
    "camera_4k_ready":healthy.get("continuous_4k_ready"),
    "js_sha256":sha(new_js),"backup_stamp":stamp
  },sort_keys=True),flush=True)
 except BaseException:
  for path in reversed(changed):
   try:
    old=originals[path]
    if old is None:path.unlink(missing_ok=True)
    else:atomic(path,old,stat.S_IMODE(path.stat().st_mode))
   except Exception:print("S9_RECORDED_NIGHT_RESTORE_FAILED_"+path.name,flush=True)
  print("S9_RECORDED_NIGHT_VIEW_V1_ROLLBACK_ATTEMPTED",flush=True)
  raise

if __name__=="__main__":main()
