#!/usr/bin/env python3
"""Compress C720P historical voice logs locally, with readback and append guards.

Uses no root privileges, changes no voice service configuration, and leaves the
same log inode for existing O_APPEND writers. Does not touch voice recordings.
"""
import datetime,gzip,hashlib,json,os,pathlib,shutil,stat,tempfile,urllib.request
FILES=(pathlib.Path("/var/log/c720p-voice-boot-manager.log"),
       pathlib.Path("/var/log/c720p-voice-startup.log"))
REPORT=pathlib.Path("/home/jespern/c720p-home-hub/reports/voice-log-archive")
def health():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:
  d=json.load(r)
 if not(d.get("ok") is True and d.get("mode")=="watching" and
   d.get("native_4k_enabled") is True and
   d.get("continuous_4k_ready") is True and
   d.get("temperature_c",99)<39):
  raise RuntimeError("S9_camera_not_healthy")
def append_only_writers(dev,ino):
 """Avoid truncating a log if a visible writer lacks O_APPEND."""
 for pid in pathlib.Path("/proc").iterdir():
  if not pid.name.isdigit():continue
  fdroot=pid/"fd"
  try:files=list(fdroot.iterdir())
  except(OSError,PermissionError):continue
  for fd in files:
   try:
    st=fd.stat()
    if (st.st_dev,st.st_ino)!=(dev,ino):continue
    info=(pid/"fdinfo"/fd.name).read_text()
    flag=next((a.split(":",1)[1].strip() for a in info.splitlines()
               if a.startswith("flags:")),None)
    if flag is None or not (int(flag,8)&os.O_APPEND):return False
   except(OSError,PermissionError,ValueError):return False
 return True
def reclaim(source):
 name=source.name
 if source.parent!=pathlib.Path("/var/log") or source.is_symlink():
  return {"name":name,"skipped":"untrusted_path"}
 if not source.is_file() or not os.access(source,os.R_OK|os.W_OK):
  return {"name":name,"skipped":"not_owned_or_not_writable"}
 fd=os.open(source,os.O_RDWR|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd)
  if (not stat.S_ISREG(before.st_mode) or before.st_nlink!=1
      or not (8*1024**2<=before.st_size<=80*1024**2)):
   return {"name":name,"skipped":"size_or_file_type"}
  if not append_only_writers(before.st_dev,before.st_ino):
   return {"name":name,"skipped":"non_append_log_writer"}
  original_size=before.st_size
  REPORT.mkdir(parents=True,exist_ok=True,mode=0o700)
  if REPORT.is_symlink():raise RuntimeError("report_symlink")
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
  out=REPORT/(stamp+"-"+name+".gz")
  if out.exists():raise RuntimeError("archive_destination_already_exists")
  with tempfile.NamedTemporaryFile(prefix="voice-log-",suffix=".gz",
                                  dir="/dev/shm",delete=False) as staged:
   tmppath=pathlib.Path(staged.name)
  try:
   digest=hashlib.sha256()
   total=0
   with os.fdopen(os.dup(fd),"rb",closefd=True) as inp,tmppath.open("wb") as raw:
    inp.seek(0)
    with gzip.GzipFile(fileobj=raw,mode="wb",compresslevel=3) as zipout:
     remaining=original_size
     while remaining>0:
      piece=inp.read(min(1048576,remaining))
      if not piece:raise RuntimeError("voice_log_shrunk_during_copy")
      digest.update(piece);zipout.write(piece);total+=len(piece)
      remaining-=len(piece)
     # Record a bounded trailing append if logging continued during copy.
     latest=os.fstat(fd)
     extra=min(max(0,latest.st_size-original_size),4*1024**2)
     if latest.st_size-original_size>4*1024**2:
      return {"name":name,"skipped":"active_log_growing_too_fast"}
     if extra:
      inp.seek(original_size)
      piece=inp.read(extra)
      if len(piece)!=extra:raise RuntimeError("log_tail_unreadable")
      digest.update(piece);zipout.write(piece);total+=len(piece)
    raw.flush();os.fsync(raw.fileno())
   if tmppath.stat().st_size>20*1024**2:
    return {"name":name,"skipped":"compressed_archive_too_large"}
   verify=hashlib.sha256();count=0
   with gzip.open(tmppath,"rb") as check:
    for part in iter(lambda:check.read(1048576),b""):
     verify.update(part);count+=len(part)
   if verify.digest()!=digest.digest() or count!=total:
    raise RuntimeError("compressed_copy_checksum_error")
   if not append_only_writers(before.st_dev,before.st_ino):
    return {"name":name,"skipped":"active_writer_changed"}
   now=os.fstat(fd)
   if (now.st_dev,now.st_ino)!=(before.st_dev,before.st_ino) or
       now.st_size-total>262144 or now.st_size<total:
    return {"name":name,"skipped":"log_changed_after_archive"}
   os.chmod(tmppath,0o600)
   os.replace(tmppath,out)
   with out.open("rb") as chk:os.fsync(chk.fileno())
   # Copytruncate: retain the existing log inode and any O_APPEND writers.
   os.ftruncate(fd,0);os.fsync(fd)
   return {"name":name,"archived_bytes":total,
     "compressed_bytes":out.stat().st_size,"archive":str(out),
     "source_checksum":digest.hexdigest(),"source_truncated":True}
  finally:
   if tmppath.exists():tmppath.unlink()
 finally:
  os.close(fd)
def main():
 os.nice(12)
 before=shutil.disk_usage("/").free
 health()
 results=[]
 for source in FILES:
  try:results.append(reclaim(source))
  except Exception as e:results.append({"name":source.name,"error":type(e).__name__})
 health()
 after=shutil.disk_usage("/").free
 print("C720P_VOICE_LOG_SAFE_RECLAIM "+json.dumps({
  "results":results,"root_before_bytes":before,"root_after_bytes":after,
  "net_reclaimed_bytes":after-before,"camera_healthy":True,
  "voice_services_stopped":False,"original_media_changed":False},sort_keys=True),flush=True)
if __name__=="__main__":main()
