#!/usr/bin/env python3
"""Guarded read-only fix for the S9+ face JPEG route in the 8794 LAN relay.

The S9+ archive proxy (8795) already serves indexed face snapshots. The
authenticated browser LAN relay (8794) did not allow the corresponding path,
causing face cards to show HTTP 404 despite 200 upstream.

Only adds a strict GET/HEAD media route AFTER authorized(); no public face
endpoint, biometric matching, upload, deletion, or archive mutation.
"""
import argparse
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
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-face-relay-v55")
SERVICE="c720p-lan-camera-relay.service"
MARK="SECURITY_S9_FACE_SNAPSHOTS_READONLY_V55"
ANCHOR="  m=re.fullmatch(r'/(new)/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)\n"
NEW=(
 "  # "+MARK+": exact indexed JPEG path through existing authentication\n"
 "  m=re.fullmatch(r'/(new)/saved/face/(motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg)',path)\n"
 "  if m:return self.archive(m.group(1),'/saved/face/'+urllib.parse.quote(m.group(2)),head)\n"
)
FACE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")

def service(action):
 r=subprocess.run(["systemctl","--user",action,SERVICE],capture_output=True,text=True,timeout=25)
 if r.returncode:raise RuntimeError("relay_service_"+action+"_failed")
 return r.stdout.strip()

def request(port,path,limit=2400000,origin=False):
 headers={"Origin":"http://192.168.178.141:8123"} if origin else {}
 with urllib.request.urlopen(urllib.request.Request(
   f"http://127.0.0.1:{port}{path}",headers=headers),timeout=22) as r:
  if r.status!=200:raise RuntimeError("unexpected_status")
  data=r.read(limit+1)
  if len(data)>limit:raise RuntimeError("oversized_response")
  return data,r.headers

def inventory():
 data,headers=request(8795,"/new/api/saved",3500000)
 doc=json.loads(data)
 if doc.get("archive_mode")!="S9-microSD-only" or not isinstance(doc.get("events"),list):
  raise RuntimeError("original_archive_unavailable")
 clips={r.get("clip_no") for r in doc["events"] if isinstance(r,dict) and CLIP.fullmatch(str(r.get("clip_no","")))}
 found=[]
 for rec in doc["events"]:
  if not isinstance(rec,dict):continue
  for f in rec.get("face_candidates",[]) or []:
   if not isinstance(f,dict):continue
   name=f.get("snapshot_name")
   if isinstance(name,str) and FACE.fullmatch(name) and f.get("snapshot_on_s9") is True:
    found.append(name)
 if not clips or len(found)<10:raise RuntimeError("verified_original_face_inventory_unavailable")
 return clips,found

def jpeg(port,name):
 path="/new/saved/face/"+urllib.parse.quote(name,safe="")
 data,headers=request(port,path,2400000,origin=True)
 if headers.get("Content-Type","").split(";")[0].strip().lower()!="image/jpeg":
  raise RuntimeError("unexpected_snapshot_content_type")
 if len(data)<512 or not data.startswith(bytes.fromhex("ffd8ff")):
  raise RuntimeError("face_snapshot_not_jpeg")
 return {"size":len(data),"digest16":hashlib.sha256(data).hexdigest()[:16],
         "cors":headers.get("Access-Control-Allow-Origin","")}

def healthy(original_clips,samples):
 now,faces=inventory()
 if not original_clips.issubset(now):raise RuntimeError("original_recordings_regressed")
 data,_=request(8794,"/new/api/saved",3500000)
 indexed=json.loads(data).get("events",[])
 if not isinstance(indexed,list) or len(indexed)<len(original_clips):
  raise RuntimeError("browser_relay_archive_regressed")
 upstream=[jpeg(8795,name) for name in samples]
 downstream=[jpeg(8794,name) for name in samples]
 if [x["digest16"] for x in upstream]!=[x["digest16"] for x in downstream]:
  raise RuntimeError("face_relay_bytes_differ")
 if service("is-active")!="active":raise RuntimeError("relay_service_not_active")
 try:
  request(8794,"/new/saved/face/not_an_indexed_face.jpg",25000)
  raise RuntimeError("invalid_media_path_not_rejected")
 except urllib.error.HTTPError as e:
  if e.code not in (400,404):raise
 return {"original_recordings":len(now),"jpeg_samples":len(samples),
         "downstream_status":200,"sha256_equal":True,"invalid_paths_rejected":True,
         "face_bytes_read":sum(x["size"] for x in downstream),
         "cors_origin":downstream[0]["cors"]}

def write_atomic(source,meta):
 fd,tmp=tempfile.mkstemp(prefix=".s9-face-v55-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(source);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(meta.st_mode))
  try:os.chown(tmp,meta.st_uid,meta.st_gid)
  except PermissionError:pass
  os.replace(tmp,TARGET)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("relay_source_missing")
 if service("is-active")!="active":raise RuntimeError("relay_inactive_before")
 originals,faces=inventory()
 samples=list(dict.fromkeys([faces[0],faces[len(faces)//2],faces[-1]]))
 for name in samples:jpeg(8795,name)
 prior=TARGET.read_bytes()
 meta=TARGET.stat()
 text=prior.decode("utf-8")
 if MARK in text:
  print("SECURITY_S9_FACE_RELAY_V55_ALREADY_VERIFIED "+
        json.dumps(healthy(originals,samples)),flush=True)
  return
 if (text.count(ANCHOR)!=1 or "SECURITY_DRIVE_PERSON_READONLY_V22" not in text or
     "if not self.authorized(): return self.empty(401)" not in text or
     "def do_HEAD(self): self.go(True)" not in text):
  raise RuntimeError("unrecognized_authenticated_relay_source")
 modified=text.replace(ANCHOR,NEW+ANCHOR,1).encode("utf-8")
 with tempfile.TemporaryDirectory(prefix="face-relay-compile-") as d:
  tmp=Path(d)/"gateway.py";tmp.write_bytes(modified)
  py_compile.compile(str(tmp),doraise=True)
 if not args.apply:
  print("SECURITY_S9_FACE_RELAY_V55_DRY_RUN "+
        json.dumps({"original_recordings":len(originals),
                    "available_face_images":len(faces),
                    "selected_probes":len(samples),
                    "strict_readonly_route":True,
                    "camera_media_or_approvals_modified":False}),flush=True)
  return
 BACK.mkdir(parents=True,exist_ok=True)
 os.chmod(BACK,0o700)
 backup=BACK/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 backup.write_bytes(prior);os.chmod(backup,0o600)
 if backup.read_bytes()!=prior or TARGET.read_bytes()!=prior:
  raise RuntimeError("backup_or_concurrent_edit")
 changed=False
 try:
  write_atomic(modified,meta);changed=True
  service("restart")
  last=None
  for _ in range(6):
   try:
    stats=healthy(originals,samples)
    print("SECURITY_S9_FACE_RELAY_V55_VERIFIED "+
          json.dumps({"backup":str(backup),"service":"active",
                      "original_media_modified":False,
                      "manual_approvals_modified":False,**stats}),flush=True)
    return
   except Exception as e:
    last=e;time.sleep(2)
  raise RuntimeError("relay_validation_failed_"+type(last).__name__)
 except BaseException:
  if changed:
   try:
    write_atomic(prior,meta)
    service("restart")
    request(8794,"/new/api/saved",3500000)
    print("SECURITY_S9_FACE_RELAY_V55_ROLLED_BACK",flush=True)
   except Exception:
    print("SECURITY_S9_FACE_RELAY_V55_MANUAL_RESTORE_REQUIRED",flush=True)
  raise

if __name__=="__main__":
 main()
