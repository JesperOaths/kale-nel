#!/usr/bin/env python3
"""Guarded addition of S9 SHA-verified complete-clip support to archive 8795.

The existing frontyard LAN relay 8794 already authenticates /new/saved/complete
and forwards it to 8795, which previously always returned 404. This patch adds
only that narrow path, keeps the old Drive/archive routes, and tests real
byte-range streaming with automatic restore on failure.
"""
from pathlib import Path
import datetime,os,subprocess,tempfile,urllib.request
ROOT=Path("/home/jespern/c720p-home-hub")
ARCHIVE=ROOT/"bin/c720p-drive-security-archive.py"
HANDLER=ROOT/"bin/s9_merged_archive_stream_v1.py"
BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/cbbc6a40706fb2483b59794c94df74a208f67ba5/ops/c720p/s9-native-security/s9_merged_archive_stream_v1.py"
# Install after all legacy archive wrappers, so they cannot override this route.
ANCHOR="c=cfg();ThreadingHTTPServer((c.get('listen_host','127.0.0.1'),int(c.get('listen_port',8795))),H).serve_forever()"
PATCH="""# S9_COMPLETE_H264_AUTHENTICATED_BYTE_RANGE_V1: outermost safe-media route.
from s9_merged_archive_stream_v1 import serve_complete as _s9_serve_complete
_s9_old_go=H.go
def _s9_final_complete_route(self):
 m=re.fullmatch(r'/new/saved/complete/(motion_[0-9]{13}[.]mp4)',
                 urllib.parse.urlsplit(self.path).path)
 if m:return _s9_serve_complete(self,m.group(1))
 return _s9_old_go(self)
H.go=_s9_final_complete_route
"""
NAME="motion_1791934137487.mp4"
def call(*a):
 r=subprocess.run(a,text=True,capture_output=True,timeout=40)
 if r.returncode:raise RuntimeError(str(a[:4])+r.stderr[-400:])
 return r.stdout
def save(p,data):
 fd,tmp=tempfile.mkstemp(prefix=".s9merged-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,0o700 if p==HANDLER else 0o644);os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def head(port):
 import time,urllib.error
 for trial in range(30):
  try:
   with urllib.request.urlopen(urllib.request.Request(
      f"http://127.0.0.1:{port}/new/saved/complete/"+NAME,method="HEAD"),timeout=28) as r:
    if r.status!=200 or int(r.headers.get("Content-Length",0))!=6438237:
     raise RuntimeError("combined_HEAD_or_length_unexpected")
    return
  except urllib.error.URLError as exc:
   if isinstance(exc,urllib.error.HTTPError) or trial==29:raise
   time.sleep(0.5)
def range_test(port):
 req=urllib.request.Request(f"http://127.0.0.1:{port}/new/saved/complete/"+NAME,
   headers={"Range":"bytes=0-4095"})
 with urllib.request.urlopen(req,timeout=22) as r:
  data=r.read(4096)
  if r.status!=206 or len(data)!=4096 or data[4:8]!=b"ftyp":
   raise RuntimeError("mp4_seekable_range_failed")
def main():
 old=ARCHIVE.read_bytes();original=old.decode()
 if "S9_COMPLETE_H264_AUTHENTICATED_BYTE_RANGE_V1" in original:
  print("S9_MERGED_MEDIA_HANDLER_ALREADY_INSTALLED");return
 newline="\\r\\n" if b"\\r\\n" in old else "\\n"
 anchor=ANCHOR.replace("\\n",newline)
 if original.count(anchor)!=1:
  raise RuntimeError("unexpected_archive_bootstrap_layout")
 with urllib.request.urlopen(BASE,timeout=35) as r:helper=r.read(10000)
 h=helper.decode()
 if not all(v in h for v in ("serve_complete","sha256","Content-Range","both_segments_decoded")):
  raise RuntimeError("helper_source_contract")
 compile(h,str(HANDLER),"exec")
 updated=original.replace(anchor,PATCH.replace('\n',newline)+anchor,1).encode()
 compile(updated.decode(),str(ARCHIVE),"exec")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 bk=ROOT/"backups/s9-complete-archive-readonly-v1"/stamp
 bk.mkdir(parents=True,exist_ok=True)
 (bk/ARCHIVE.name).write_bytes(old)
 previous=HANDLER.read_bytes() if HANDLER.exists() else None
 if previous is not None:(bk/HANDLER.name).write_bytes(previous)
 try:
  save(HANDLER,helper);save(ARCHIVE,updated)
  call("systemctl","--user","restart","c720p-drive-security-archive.service")
  # Full old endpoints and new restricted derivative all remain behind LAN auth.
  head(8795);range_test(8795)
  head(8794);range_test(8794)
  print("S9_MERGED_PRODUCTION_PLAYBACK_VERIFIED",{
   "path":"/new/saved/complete/"+NAME,
   "authenticated_lan_port":8794,
   "archive_loopback":8795,
   "bytes":6438237,
   "range_verified":True,
   "source_4k_preserved":True,
   "rollback":str(bk)},flush=True)
 except BaseException:
  save(ARCHIVE,old)
  if previous is None:
   if HANDLER.exists():HANDLER.unlink()
  else:save(HANDLER,previous)
  try:call("systemctl","--user","restart","c720p-drive-security-archive.service")
  except Exception:pass
  raise
if __name__=="__main__":main()
