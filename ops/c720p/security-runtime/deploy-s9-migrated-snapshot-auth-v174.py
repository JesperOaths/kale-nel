#!/usr/bin/env python3
"""Guarded, additive S9 migrated-JPEG replay through existing authorized C720P relays.

Two existing source blobs are immutable-pinned, backed up, and patched only at
the already tested imported-MP4 anchor. Only the SHA-verified private JPEG
handler and two metadata relay services are touched. No camera/video changes,
no Save/Delete action, no new CORS origin, no local JPG/MP4 deletion.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin"
INNER=BIN/"s9_sd_proxy_extension.py"
OUTER=BIN/"c720p-lan-camera-relay.py"
HANDLER=BIN/"s9_c720p_snapshots_v163.py"
BACK=HOME/"backups/s9-migrated-snapshot-route-v174"
INNER_SHA="36f042b42237c4691f6a2cde9b695b468552018ccb2d5f178c69b36764574bed"
OUTER_SHA="8003ceac8ed4deabfcfeae715568635c971cb2aa93d98f0695b16488d6d538df"
INNER_UNIT="c720p-drive-security-archive.service"
OUTER_UNIT="c720p-lan-camera-relay.service"
INNER_ANCHOR=" s9_c720p_imported_media_api_v1.install(H,play_sd)"
INNER_ADD="\n import s9_c720p_snapshots_v163\n s9_c720p_snapshots_v163.install(H)"
OUTER_ANCHOR="   return self.archive(m.group(1),'/saved/c720p-migrated/clip/'+urllib.parse.quote(m.group(2)),head)"
OUTER_ADD="""\n  m=re.fullmatch(r'/(new)/saved/c720p-migrated/snap/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg)',path)
  if m:
   return self.archive(m.group(1),'/saved/c720p-migrated/snap/'+urllib.parse.quote(m.group(2)),head)"""
NEW_ROUTE="/new/saved/c720p-migrated/snap/"
def sha(data):return hashlib.sha256(data).hexdigest()
def safe_file(path,limit):
 if path.is_symlink() or not path.is_file() or not 100<path.stat().st_size<=limit:
  raise RuntimeError("missing_or_untrusted_known_relay_source")
 return path.read_bytes()
def patch_inner(body):
 if sha(body)!=INNER_SHA:raise RuntimeError("unexpected_live_inner_metadata_revision")
 s=body.decode("utf8")
 if s.count(INNER_ANCHOR)!=1 or "s9_c720p_snapshots_v163.install(H)" in s:
  raise RuntimeError("inner_snapshot_hook_contract_not_unique")
 out=s.replace(INNER_ANCHOR,INNER_ANCHOR+INNER_ADD,1)
 if out.replace(INNER_ADD,"")!=s:raise RuntimeError("inner_patch_not_additive")
 return out.encode("utf8")
def patch_outer(body):
 if sha(body)!=OUTER_SHA:raise RuntimeError("unexpected_live_authenticated_relay_revision")
 s=body.decode("utf8")
 if (s.count(OUTER_ANCHOR)!=1 or NEW_ROUTE in s
     or s.count("Access-Control-Expose-Headers")!=1):
  raise RuntimeError("outer_authenticated_route_contract_not_unique")
 out=s.replace(OUTER_ANCHOR,OUTER_ANCHOR+OUTER_ADD,1)
 if (out.replace(OUTER_ADD,"")!=s or
     out.count("Access-Control-Allow-Origin")!=s.count("Access-Control-Allow-Origin")
     or out.count("Access-Control-Expose-Headers")!=s.count("Access-Control-Expose-Headers")
     or out.count("if self.origin_ok()")!=s.count("if self.origin_ok()")):
  raise RuntimeError("outer_authorization_contract_would_change")
 return out.encode("utf8")
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  if r.status!=200:raise RuntimeError("native_4k_status_unavailable")
  data=r.read(65537)
 if len(data)>65536:raise RuntimeError("camera_status_oversize")
 d=json.loads(data)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<=39.5
     or type(d.get("continuous_4k_buffered_ms")) is not int
     or d["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("camera_capture_must_remain_idle_and_cool")
 return d
def svc(name,action):
 p=subprocess.run(["systemctl","--user",action,name],
   capture_output=True,text=True,timeout=35)
 if p.returncode:raise RuntimeError("snapshot_relay_service_"+action+"_failed")
 return p.stdout.strip()
def checked_response(url,head=False,tries=1):
 request=urllib.request.Request(url,method="HEAD" if head else "GET",
                                headers={"Cache-Control":"no-cache"})
 for i in range(tries):
  try:
   with urllib.request.urlopen(request,timeout=18) as r:
    if r.status!=200:raise RuntimeError("private_snapshot_route_http_failure")
    return {k.lower():v for k,v in r.headers.items()},r.read(20000 if not head else 0)
  except urllib.error.URLError as e:
   if not isinstance(e.reason,ConnectionRefusedError) or i==tries-1:raise
   time.sleep(.5)
 raise RuntimeError("metadata_relay_cannot_rebind")
def probe_api(port):
 headers,body=checked_response(
  "http://127.0.0.1:%d/new/api/c720p-migrated-clips"%port,tries=30)
 if "json" not in headers.get("content-type",""):
  raise RuntimeError("old_authenticated_mp4_index_regressed")
 doc=json.loads(body)
 if (doc.get("ok") is not True or doc.get("schema_version")!="c720p_s9_verified_import_v2"
     or type(doc.get("total_imported")) is not int
     or doc["total_imported"]<6):
  raise RuntimeError("imported_original_mp4_index_unavailable")
def check_image(port,name,length):
 path=NEW_ROUTE+urllib.parse.quote(name)
 headers,_=checked_response("http://127.0.0.1:%d"%port+path,head=True,tries=2)
 if (headers.get("content-type")!="image/jpeg" or
     headers.get("content-length")!=str(length) or
     headers.get("x-content-type-options")!="nosniff"
     or headers.get("cache-control")!="private,no-store"):
  raise RuntimeError("private_snapshot_response_header_drift")
def atomic(path,blob):
 if path.is_symlink():raise RuntimeError("unknown_relay_symlink")
 mode=stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
 fd,tmp=tempfile.mkstemp(prefix=".s9-jpeg-route-v174-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:
   os.fchmod(out.fileno(),mode)
   out.write(blob);out.flush();os.fsync(out.fileno())
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def verified_handler(path,expected):
 body=safe_file(path,100000)
 if sha(body)!=expected:raise RuntimeError("pinned_snapshot_reader_sha_drift")
 spec=importlib.util.spec_from_file_location("s9_jpeg_reader_v174",path)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 if module.SCHEMA!="c720p_s9_snapshots_v162":
  raise RuntimeError("source_snapshot_schema_not_supported")
 proof=module.read_proof()
 if len(proof)<6:raise RuntimeError("six_snapshots_not_sha_qualified")
 # No filenames/hashes/photos ever emitted to logs or user status.
 return body,next(iter(sorted(proof.items())))
def main(source,expected,apply):
 old_i=safe_file(INNER,150000);old_o=safe_file(OUTER,150000)
 new_i=patch_inner(old_i);new_o=patch_outer(old_o)
 blob,sample=verified_handler(source,expected)
 name,entry=sample
 if HANDLER.exists() or HANDLER.is_symlink():
  raise RuntimeError("unknown_or_already_live_snapshot_module")
 with tempfile.TemporaryDirectory(prefix="s9-jpeg-replay-source-v174-") as d:
  for key,raw in (("inner.py",new_i),("outer.py",new_o)):
   p=Path(d)/key;p.write_bytes(raw)
   py_compile.compile(str(p),doraise=True)
 for unit in (INNER_UNIT,OUTER_UNIT):
  if svc(unit,"is-active")!="active":
   raise RuntimeError("existing_metadata_service_not_active")
 before=camera()
 if not apply:
  print("S9_SNAPSHOT_AUTH_V174_PREFLIGHT "+json.dumps({
   "six_verified_snapshots":True,"old_relay_shas_pinned":True,
   "existing_video_routes_preserved":True,"authorization_unchanged":True,
   "capture_temperature_c":before["temperature_c"],
   "no_service_restarts":True,"originals_modified":False,
   "human_reviews_modified":False},sort_keys=True),flush=True)
  return
 backup=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,raw in (("inner.py",old_i),("outer.py",old_o)):
  p=backup/key;p.write_bytes(raw);os.chmod(p,0o600)
  if p.read_bytes()!=raw:raise RuntimeError("private_backups_not_verified")
 changed=[]
 try:
  if safe_file(INNER,150000)!=old_i or safe_file(OUTER,150000)!=old_o:
   raise RuntimeError("concurrent_relay_revision_changed")
  atomic(HANDLER,blob);changed.append(HANDLER)
  atomic(INNER,new_i);changed.append(INNER)
  svc(INNER_UNIT,"restart")
  if svc(INNER_UNIT,"is-active")!="active":raise RuntimeError("inner_not_ready")
  probe_api(8795)
  check_image(8795,name,entry["bytes"])
  atomic(OUTER,new_o);changed.append(OUTER)
  svc(OUTER_UNIT,"restart")
  if svc(OUTER_UNIT,"is-active")!="active":raise RuntimeError("outer_not_ready")
  probe_api(8794)
  check_image(8794,name,entry["bytes"])
  after=camera()
  if (safe_file(INNER,150000)!=new_i or safe_file(OUTER,150000)!=new_o
      or safe_file(HANDLER,100000)!=blob):
   raise RuntimeError("relay_source_drift_after_deploy")
  print("S9_SNAPSHOT_AUTH_V174_VERIFIED "+json.dumps({
   "source_verified_jpeg_count":6,"inner_metadata_http_200":True,
   "authenticated_outer_http_200":True,
   "private_legacy_snapshot_head_verified":True,
   "existing_mp4_index_preserved":True,
   "authorization_source_byte_preserved":True,
   "camera_dropped_frames_after":after["continuous_4k_dropped_output_frames"],
   "camera_apk_modified":False,"originals_modified":False,
   "manual_reviews_modified":False,"legacy_save_delete_modified":False,
   "local_copy_retirement_allowed":False,
   "protected_backup":True},sort_keys=True),flush=True)
 except BaseException:
  # Revert only files which still exactly match our versions; do not roll
  # back concurrent newer code or touch any video/user review.
  if OUTER in changed and OUTER.is_file() and sha(OUTER.read_bytes())==sha(new_o):
   atomic(OUTER,old_o)
   svc(OUTER_UNIT,"restart")
  if INNER in changed and INNER.is_file() and sha(INNER.read_bytes())==sha(new_i):
   atomic(INNER,old_i)
   svc(INNER_UNIT,"restart")
  if HANDLER in changed and HANDLER.is_file() and sha(HANDLER.read_bytes())==sha(blob):
   HANDLER.unlink()
  print("S9_SNAPSHOT_AUTH_V174_ROLLBACK "+json.dumps({
   "originals_modified":False,"camera_apk_modified":False,
   "manual_reviews_modified":False},sort_keys=True),flush=True)
  raise
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--source",type=Path,required=True)
 p.add_argument("--sha256",required=True)
 p.add_argument("--apply",action="store_true")
 x=p.parse_args()
 if not re.fullmatch(r"[a-f0-9]{64}",x.sha256):raise ValueError("invalid_pinned_snapshot_source_sha")
 main(x.source,x.sha256,x.apply)
