#!/usr/bin/env python3
"""Authenticated LAN relay support for SHA-verified S9 combined MP4 files.

Called only by localhost 8795 archive server after the front LAN relay has
checked its signed viewer session. Fetches finalized derivative read-only from
S9 microSD into a bounded private RAM cache, then serves HTTP byte ranges.
Never modifies source 4K/pre-roll recordings; no phone transcoding.
"""
import hashlib,json,os,re,shutil,subprocess,tempfile,threading,time
from pathlib import Path

ROOT=Path("/home/jespern/c720p-home-hub/build/s9-complete-worker-v1")
CACHE=Path(tempfile.gettempdir())/"s9-complete-signed-cache-v1"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
PROOF=Path("/home/jespern/c720p-home-hub/build/s9-onphone-prepended-mp4-v1c/verified-one-off-combined-mp4.json")
NAME=re.compile(r"motion_[0-9]{13}[.]mp4")
LOCK=threading.Lock()
MAX_CACHE=180*1024*1024

def receipt(name):
 p=ROOT/"receipts"/(name+".json")
 try:
  if p.is_file():
   d=json.loads(p.read_text())
   if d.get("verified") and d.get("original_4k_unchanged") and (
    d.get("combined_name")==name+".complete.mp4") and (
    d.get("backend")=="bounded_c720p_isolated_worker"):
    return d
  if name=="motion_1791933495875.mp4" and PROOF.is_file():
   d=json.loads(PROOF.read_text())
   if d.get("verified") and d.get("originals_untouched") and (
    d.get("combined_path_on_phone","").endswith("/"+name+".complete.mp4")):
    return d
 except (ValueError,OSError):pass
 return None

def expected(d):
 size=int(d.get("bytes",0))
 key=str(d.get("sha256",""))
 if not 80000<size<100*1024*1024 or not re.fullmatch("[a-f0-9]{64}",key):
  raise ValueError("bad_receipt")
 return size,key

def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1048576),b""):h.update(b)
 return h.hexdigest()

def adb_phone():
 p=subprocess.run(["adb","devices","-l"],capture_output=True,text=True,timeout=12)
 if p.returncode:raise RuntimeError("adb_not_available")
 devices=[line.split()[0] for line in p.stdout.splitlines() if
          " device " in line and "model:SM_G965F" in line and "usb:" in line]
 if len(devices)!=1:raise RuntimeError("authorized_s9_usb_unavailable")
 return devices[0]

def prune(keep):
 files=[p for p in CACHE.glob("motion_*.complete.mp4")
        if p.is_file() and p!=keep and not p.is_symlink()]
 files.sort(key=lambda p:p.stat().st_mtime,reverse=True)
 total=keep.stat().st_size if keep.is_file() else 0
 for f in files:
  size=f.stat().st_size
  if total+size<=MAX_CACHE:total+=size
  else:
   try:f.unlink()
   except OSError:pass

def cached(name,d):
 size,key=expected(d)
 CACHE.mkdir(parents=True,exist_ok=True,mode=0o700)
 target=CACHE/(name+".complete.mp4")
 with LOCK:
  if target.is_file() and target.stat().st_size==size and digest(target)==key:
   os.utime(target,None);return target
  if shutil.disk_usage(CACHE).free<size+180*1024*1024:
   raise RuntimeError("ram_cache_capacity_insufficient")
  serial=adb_phone()
  intermediate=CACHE/(name+".complete.downloading")
  if intermediate.is_file():intermediate.unlink()
  try:
   remote=SD+"/"+target.name
   cmd=["adb","-s",serial,"pull",remote,str(intermediate)]
   p=subprocess.run(cmd,capture_output=True,text=True,timeout=115)
   if p.returncode:raise RuntimeError("s9_verified_clip_pull_failed")
   if intermediate.stat().st_size!=size or digest(intermediate)!=key:
    raise RuntimeError("verified_upload_mismatch")
   os.replace(intermediate,target)
  finally:
   if intermediate.is_file():intermediate.unlink()
  prune(target)
 return target

def error(h,status,reason):
 raw=json.dumps({"ok":False,"error":reason},separators=(",",":")).encode()
 h.send_response(status)
 h.send_header("Content-Type","application/json")
 h.send_header("Content-Length",str(len(raw)))
 h.send_header("Cache-Control","private, no-store")
 h.send_header("X-Content-Type-Options","nosniff")
 h.end_headers()
 if h.command!="HEAD":h.wfile.write(raw)

def serve_complete(h,name):
 if not NAME.fullmatch(name):return error(h,404,"not_found")
 proof=receipt(name)
 if proof is None:return error(h,404,"combined_not_verified")
 try:
  f=cached(name,proof)
  size=f.stat().st_size
 except Exception as exc:
  return error(h,503,"verified_combined_media_unavailable")
 start,end,partial=0,size-1,False
 rang=h.headers.get("Range")
 if rang:
  m=re.fullmatch(r"bytes=([0-9]*)-([0-9]*)",rang.strip())
  if not m or (not m.group(1) and not m.group(2)):
   h.send_response(416);h.send_header("Content-Range",f"bytes */{size}")
   h.send_header("Content-Length","0");h.end_headers();return
  try:
   if m.group(1):
    start=int(m.group(1))
    end=min(size-1,int(m.group(2))) if m.group(2) else size-1
   else:
    suffix=int(m.group(2))
    start=max(0,size-suffix) if suffix else size
  except ValueError:return error(h,416,"invalid_range")
  if start>=size or start>end:
   h.send_response(416);h.send_header("Content-Range",f"bytes */{size}")
   h.send_header("Content-Length","0");h.end_headers();return
  partial=True
 length=end-start+1
 h.send_response(206 if partial else 200)
 h.send_header("Content-Type","video/mp4")
 h.send_header("Accept-Ranges","bytes")
 h.send_header("Content-Length",str(length))
 if partial:h.send_header("Content-Range",f"bytes {start}-{end}/{size}")
 h.send_header("Cache-Control","private, no-store")
 h.send_header("X-Content-Type-Options","nosniff")
 h.end_headers()
 if h.command=="HEAD":return
 try:
  with f.open("rb") as rd:
   rd.seek(start)
   while length>0:
    data=rd.read(min(length,65536))
    if not data:break
    h.wfile.write(data)
    length-=len(data)
 except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
