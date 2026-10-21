#!/usr/bin/env python3
"""Forward-only, server-owned ORIGINAL MP4 SHA256 attestor for manual reviews.

No HTTP input can dictate paths or digests. SD uses the S9+ phone's original
sha256sum; Drive streams a verified remote MP4 once, without temporary files.
Both compare current source identity/revision before and after full hashing.
Current-revision checks compare provider identity and metadata, not bytes;
an independent periodic full-SHA audit remains required for changes retaining
the same stat fields or deliberate MD5 collisions. Not installed by default.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shlex
import shutil
import stat
import subprocess
import time
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
STATE=BASE/"state"
SDINDEX=STATE/"s9-standalone-archive-catalog-v1.json"
DRIVEINDEX=STATE/"drive-security-archive.json"
CONFIG=BASE/"config/drive-security-archive.json"
LOCK=STATE/"s9-v3-archive-backfill.lock"
PHONE="192.168.178.250:5555"
SDROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
CAMERA="http://127.0.0.1:18808/status"
SDNAME=re.compile(r"motion_[0-9]{13}\.mp4\Z")
DRIVENAME=re.compile(r"[A-Za-z0-9._-]{1,180}\.mp4\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
MD5=re.compile(r"[0-9a-fA-F]{32}\Z")
MAX_BYTES=950000000
MIN_DISK=850*1024*1024

class Refused(RuntimeError):pass
def ensure(ok,msg):
 if not ok:raise Refused(msg)

def metadata(path,limit,private=False):
 ensure(path.is_file() and not path.is_symlink(),"trusted_source_missing")
 st=path.stat()
 ensure(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==os.geteuid()
        and 10<st.st_size<=limit and not st.st_mode&(0o077 if private else 0o022),
        "trusted_metadata_mode")
 raw=path.read_bytes()
 ensure(len(raw)==st.st_size and path.stat().st_mtime_ns==st.st_mtime_ns,
        "trusted_metadata_changed")
 return json.loads(raw)

def source(source,name):
 ensure(source in ("sd","drive") and isinstance(name,str),"source_unknown")
 if source=="sd":
  ensure(SDNAME.fullmatch(name),"unsafe_original_basename")
  catalog=metadata(SDINDEX,5000000)
  row=catalog.get("records",{}).get(name)
  ensure(isinstance(row,dict) and type(row.get("bytes")) is int
         and 10000<=row["bytes"]<=MAX_BYTES,"sd_original_not_indexed")
  return row,None
 ensure(DRIVENAME.fullmatch(name) and ".." not in name,"unsafe_original_basename")
 catalog=metadata(DRIVEINDEX,6000000)
 items=catalog.get("items",[])
 rows=[row for row in items if isinstance(row,dict) and row.get("remote_name")==name
   and row.get("state")=="verified" and row.get("camera")=="new"
   and type(row.get("size")) is int and 10000<=row["size"]<=MAX_BYTES]
 ensure(len(rows)==1,"drive_original_not_uniquely_indexed")
 cfg=metadata(CONFIG,100000)
 folder=cfg.get("folders",{}).get("new",{})
 ensure(isinstance(folder,dict) and isinstance(folder.get("id"),str)
        and 6<=len(folder["id"])<=200
        and isinstance(cfg.get("remote"),str)
        and re.fullmatch(r"[A-Za-z0-9_-]{1,80}",cfg["remote"])
        and isinstance(cfg.get("rclone"),str)
        and os.path.realpath(cfg["rclone"])=="/usr/bin/rclone"
        and isinstance(cfg.get("rclone_config"),str),
        "drive_worker_config_untrusted")
 return rows[0],cfg

def adb(command,timeout=25):
 try:proc=subprocess.run(["adb","-s",PHONE,"shell",command],
      capture_output=True,text=True,timeout=timeout,check=False)
 except (OSError,subprocess.TimeoutExpired):
  raise Refused("phone_original_unavailable") from None
 ensure(proc.returncode==0 and len(proc.stdout)<2000 and len(proc.stderr)<2000,
        "phone_original_unavailable")
 return proc.stdout.strip()

def sd_revision(name,row):
 path=SDROOT+"/"+name
 result=adb("stat -c '%i:%s:%Y:%y' "+shlex.quote(path))
 fields=result.split(":",3)
 ensure(len(fields)==4 and all(s.isdecimal() for s in fields[:3])
   and len(fields[3])>=16 and int(fields[1])==row["bytes"]
   and int(fields[0])>0 and int(fields[2])>1000000000,
   "sd_original_revision_unavailable")
 return {"source_identity":"sd:"+name,
  "source_revision":"rev:"+hashlib.sha256(result.encode()).hexdigest(),
  "size":row["bytes"]}

def drive_revision(name,row,cfg):
 args=[cfg["rclone"],"--config",cfg["rclone_config"],"lsjson",
  cfg["remote"]+":"+name,"--drive-root-folder-id",
  cfg["folders"]["new"]["id"],"--files-only","--stat","--hash"]
 try:proc=subprocess.run(args,capture_output=True,text=True,timeout=45,check=False)
 except (OSError,subprocess.TimeoutExpired):
  raise Refused("drive_metadata_unavailable") from None
 ensure(proc.returncode==0 and len(proc.stdout)<100000,
   "drive_metadata_unavailable")
 try:
  info=json.loads(proc.stdout)
  if isinstance(info,list) and len(info)==1:info=info[0]
 except (ValueError,TypeError):raise Refused("drive_metadata_invalid") from None
 ensure(isinstance(info,dict),"drive_metadata_invalid")
 hashes=info.get("Hashes")
 md5=next((value.lower() for key,value in hashes.items()
   if str(key).lower()=="md5" and isinstance(value,str) and MD5.fullmatch(value)),None
 ) if isinstance(hashes,dict) else None
 identity=info.get("ID")
 ensure(isinstance(identity,str) and re.fullmatch(r"[A-Za-z0-9_-]{10,160}",identity)
   and isinstance(info.get("ModTime"),str) and len(info["ModTime"])>=19
   and md5 is not None and type(info.get("Size")) is int
   and info["Size"]==row["size"],"drive_revision_incomplete")
 # Native Drive version is absent in this rclone build: use an explicit
 # object/content descriptor, not a fabricated Drive version number.
 content="\0".join([identity,str(row["size"]),info["ModTime"],md5])
 return {"source_identity":"drive:"+identity,
  "source_revision":"rev:"+hashlib.sha256(content.encode()).hexdigest(),
  "size":row["size"]}

def native_health():
 ensure(shutil.disk_usage("/").free>=MIN_DISK,"hub_root_reserve_low")
 try:
  with urllib.request.urlopen(CAMERA,timeout=9) as response:
   ensure(response.status==200,"native_camera_unavailable")
   raw=response.read(65537)
  ensure(len(raw)<=65536,"native_camera_unavailable")
  doc=json.loads(raw)
 except (OSError,ValueError,TypeError):
  raise Refused("native_camera_unavailable") from None
 ensure(doc.get("ok") is True and doc.get("mode")=="watching" and
   doc.get("native_4k_enabled") is True and
   doc.get("continuous_4k_ready") is True and
   doc.get("continuous_4k_dropped_output_frames")==0 and
   not doc.get("continuous_4k_error"),"native_camera_unhealthy")
 temp=doc.get("temperature_c")
 ensure(type(temp) in (int,float) and 0<temp<=35.0,
   "native_camera_temperature_guard")
 ensure(not any(doc.get(field) is True for field in (
   "recording_active","recording_in_progress","face_backfill_queued",
   "appearance_backfill_queued","historical_import_queued")),
   "native_camera_or_worker_busy")

def drive_bytes_sha(cmd,expected,max_seconds=150):
 try:proc=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,
      stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
 except OSError:raise Refused("drive_stream_unavailable") from None
 total=0;sha=hashlib.sha256();end=time.monotonic()+max_seconds
 try:
  fd=proc.stdout.fileno()
  while True:
   remain=end-time.monotonic()
   ensure(remain>0,"drive_stream_timeout")
   ready,_,_=select.select([fd],[],[],min(4,remain))
   if not ready:continue
   chunk=os.read(fd,131072)
   if not chunk:break
   total+=len(chunk)
   ensure(total<=expected and total<=MAX_BYTES,"drive_stream_size_exceeded")
   sha.update(chunk)
  ensure(proc.wait(timeout=max(.1,end-time.monotonic()))==0 and total==expected,
         "drive_stream_incomplete")
  return sha.hexdigest()
 except (OSError,subprocess.TimeoutExpired):
  raise Refused("drive_stream_unavailable") from None
 finally:
  if proc.poll() is None:proc.kill()
  try:proc.wait(timeout=8)
  except subprocess.TimeoutExpired:raise Refused("drive_stream_cleanup_failed") from None
  proc.stdout.close()

class IndependentOriginalAttestor:
 def current_revision(self,source_type,name):
  row,cfg=source(source_type,name)
  detail=sd_revision(name,row) if source_type=="sd" else drive_revision(name,row,cfg)
  return {"source_identity":detail["source_identity"],
          "source_revision":detail["source_revision"]}

 def verify_bytes(self,source_type,name):
  row,cfg=source(source_type,name)
  ensure(LOCK.is_file() and not LOCK.is_symlink(),"worker_mutex_unavailable")
  with LOCK.open("r") as lock:
   try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:raise Refused("worker_mutex_busy") from None
   native_health()
   original=sd_revision(name,row) if source_type=="sd" else drive_revision(name,row,cfg)
   if source_type=="sd":
    path=SDROOT+"/"+name
    fields=adb("sha256sum "+shlex.quote(path),timeout=130).split()
    ensure(len(fields)==2 and SHA.fullmatch(fields[0]) and fields[1]==path,
           "phone_original_sha256_unavailable")
    digest=fields[0]
   else:
    cmd=[cfg["rclone"],"--config",cfg["rclone_config"],"cat",
     cfg["remote"]+":"+name,"--drive-root-folder-id",cfg["folders"]["new"]["id"]]
    digest=drive_bytes_sha(cmd,original["size"])
   native_health()
   after=sd_revision(name,row) if source_type=="sd" else drive_revision(name,row,cfg)
   ensure(original==after,"original_changed_while_hashed")
  return {"source":source_type,"name":name,
   "source_identity":original["source_identity"],
   "source_revision":original["source_revision"],
   "sha256":digest,"size_bytes":original["size"],
   "verified_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
   "verified_original_bytes":True,"method":"streamed_sha256_original_mp4",
   "verifier":"phone-original-byte-auditor" if source_type=="sd"
        else "drive-original-byte-auditor"}
