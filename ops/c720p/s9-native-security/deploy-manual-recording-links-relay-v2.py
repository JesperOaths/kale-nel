#!/usr/bin/env python3
"""Install exact authenticated 8794 route for manual metadata links, no media changes.

Must run AFTER the 8795 backend installer validates its own endpoint.
Read-only GET, explicit human-initiated POST, original archive still intact.
Atomic source backup/restart/readback; restore original relay on any failure.
"""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.request

RELAY=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-manual-links-relay-v2")
UNIT="c720p-lan-camera-relay.service"
MARKER="S9_MANUAL_LINKS_LAN_ROUTE_V2"
GET_ANCHOR=("  m=re.fullmatch(r'/(new)/api/saved',path)\n"
            "  if m:return self.archive(m.group(1),'/api/saved',head)")
POST_ANCHOR=("  parts=path.strip('/').split('/')\n"
             "  if len(parts)!=2 or parts[0] not in UP or parts[1]!='camera-control': return self.empty(404)")
CORS_ANCHOR="Authorization,Content-Type,X-C720P-Relay-Token"
GET_ADD=(
 "  # "+MARKER+" read-only, guarded after authorized()\n"
 "  m=re.fullmatch(r'/(new)/api/s9-manual-recording-links',path)\n"
 "  if m:return self.archive(m.group(1),'/api/s9-manual-recording-links',head)\n"
)
POST_ADD=(
 "  # "+MARKER+" authenticated manual review metadata only\n"
 "  if path=='/new/api/s9-manual-recording-links':\n"
 "   if not self.authorized():return self.empty(401)\n"
 "   if not self.origin_ok() or self.headers.get('X-S9-Manual-Link-Intent')!='manual-original-review-links-v1':return self.empty(403)\n"
 "   if self.headers.get('Sec-Fetch-Site','') not in ('','same-origin','none'):return self.empty(403)\n"
 "   try:\n"
 "    n=int(self.headers.get('Content-Length','0'))\n"
 "    if not 35<=n<=1400 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(415)\n"
 "    body=self.rfile.read(n);obj=json.loads(body)\n"
 "    if not isinstance(obj,dict) or set(obj)!={'action','source','name','folder','revision','human_confirmed'}:return self.empty(400)\n"
 "    if obj.get('human_confirmed') is not True or obj.get('action') not in ('assign','return_to_queue'):return self.empty(400)\n"
 "    header={'Content-Type':'application/json','X-S9-Manual-Link-Intent':'manual-original-review-links-v1'}\n"
 "    if self.headers.get('Origin'):header['Origin']=self.headers['Origin']\n"
 "    req=urllib.request.Request('http://127.0.0.1:8795/new/api/s9-manual-recording-links',data=body,headers=header,method='POST')\n"
 "    try:r=urllib.request.urlopen(req,timeout=16)\n"
 "    except urllib.error.HTTPError as error:r=error\n"
 "    data=r.read(12000);self.send_response(r.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return\n"
 "   except Exception:return self.empty(502)\n"
)

def checksum(blob):return hashlib.sha256(blob).hexdigest()
def service(action):
 result=subprocess.run(["systemctl","--user",action,UNIT],capture_output=True,
                       text=True,timeout=28)
 if result.returncode:raise RuntimeError("authenticated_relay_service_failed")
 return result.stdout.strip()
def read(port,path):
 with urllib.request.urlopen("http://127.0.0.1:"+str(port)+path,timeout=18) as response:
  raw=response.read(5_000_001)
  if len(raw)>5_000_000:raise RuntimeError("oversized_catalog_response")
 return json.loads(raw)
def health():
 private=read(8794,"/new/api/s9-manual-recording-links")
 if not(private.get("ok") is True and private.get("manual_links_only") is True
        and private.get("automatic_identity_matching") is False):
  raise RuntimeError("signed_relay_route_missing")
 sd=read(8794,"/new/api/saved")
 drive=read(8794,"/new/api/drive-saved")
 if (sd.get("archive_mode")!="S9-microSD-only" or
     not isinstance(sd.get("events"),list) or len(sd["events"])<70 or
     not isinstance(drive.get("events"),list) or len(drive["events"])<100):
  raise RuntimeError("existing_archive_source_regressed")
 if service("is-active")!="active":raise RuntimeError("relay_not_active")
 return {"sd_originals":len(sd["events"]),"historical_drive_clips":len(drive["events"]),
         "manual_link_revision":private["revision"],"readonly_recordings_preserved":True}
def atomic(blob,owner):
 fd,tmp=tempfile.mkstemp(prefix=".s9-manual-links-relay-v2-",dir=RELAY.parent)
 try:
  with os.fdopen(fd,"wb") as out:
   out.write(blob);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(owner.st_mode))
  try:os.chown(tmp,owner.st_uid,owner.st_gid)
  except PermissionError:pass
  os.replace(tmp,RELAY)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def main():
 if not RELAY.is_file() or RELAY.is_symlink():raise RuntimeError("unsafe_relay_source")
 if service("is-active")!="active":raise RuntimeError("relay_inactive")
 upstream=read(8795,"/new/api/s9-manual-recording-links")
 if upstream.get("manual_links_only") is not True or upstream.get("automatic_identity_matching") is not False:
  raise RuntimeError("upstream_review_link_route_missing")
 original=RELAY.read_bytes()
 owner=RELAY.stat()
 text=original.decode()
 if MARKER in text:
  result=health()
  print("S9_MANUAL_LINKS_LAN_RELAY_VERIFIED "+json.dumps({"already":True,**result}),flush=True)
  return
 for marker in ("SECURITY_NATIVE_CAMERA2_RELAY_V18","SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16"):
  if marker not in text:raise RuntimeError("required_relay_security_contract_missing")
 for anchor in (GET_ANCHOR,POST_ANCHOR):
  if text.count(anchor)!=1:raise RuntimeError("route_insertion_anchor_changed")
 if text.count(CORS_ANCHOR)!=1:raise RuntimeError("cors_source_changed")
 patched=(text.replace(GET_ANCHOR,GET_ADD+GET_ANCHOR,1)
              .replace(POST_ANCHOR,POST_ADD+POST_ANCHOR,1)
              .replace(CORS_ANCHOR,CORS_ANCHOR+",X-S9-Manual-Link-Intent",1)).encode()
 with tempfile.TemporaryDirectory(prefix="s9-manual-link-compile-") as tmp:
  test=Path(tmp)/"relay.py";test.write_bytes(patched)
  py_compile.compile(str(test),doraise=True)
 BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
 backup=BACK/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 with backup.open("xb") as dst:dst.write(original);dst.flush();os.fsync(dst.fileno())
 os.chmod(backup,0o600)
 if backup.read_bytes()!=original or RELAY.read_bytes()!=original:
  raise RuntimeError("relay_source_concurrent_change")
 installed=False
 try:
  atomic(patched,owner);installed=True;service("restart")
  for _ in range(12):
   try:
    result=health()
    print("S9_MANUAL_LINKS_LAN_RELAY_VERIFIED "+json.dumps({
      "already":False,**result,"backup":str(backup),
      "prior_sha256":checksum(original),"installed_sha256":checksum(patched),
      "camera_modified":False,"videos_modified":False}),flush=True)
    return
   except Exception:time.sleep(2)
  raise RuntimeError("signed_relay_post_restart_validation_failed")
 except BaseException:
  if installed:
   try:
    atomic(original,owner);service("restart")
    sd=read(8794,"/new/api/saved")
    if sd.get("archive_mode")!="S9-microSD-only":raise RuntimeError("rollback_archive_broken")
    print("S9_MANUAL_LINKS_LAN_RELAY_ROLLED_BACK",flush=True)
   except Exception:print("S9_MANUAL_LINKS_LAN_RELAY_MANUAL_RECOVERY_REQUIRED",flush=True)
  raise

if __name__=="__main__":main()
