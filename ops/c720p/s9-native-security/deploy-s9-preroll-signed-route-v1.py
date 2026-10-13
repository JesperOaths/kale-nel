#!/usr/bin/env python3
"""Allow signed read-only access to indexed pre-event S9+ MP4 companions.

Upstream 8795 already validates clip names against the S9 index and HEADs
the on-phone 8808 endpoint. The LAN relay currently returns 404 before
reaching it. Restore only /new/saved/preroll/motion_<ms>.mp4 (no arbitrary
paths), using existing owner authentication, CORS and HTTP range controls.
"""
import datetime as dt,hashlib,os,re,stat,subprocess,tempfile,time,urllib.request,urllib.error,json
from pathlib import Path
TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-preroll-signed-relay-v1")
SERVICE="c720p-lan-camera-relay.service"
ANCHOR="   m=re.fullmatch(r'/(new)/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)"
INSERT="""   # S9_PREROLL_SIGNED_READONLY_V1: exact indexed companion after auth.
   m=re.fullmatch(r'/(new)/saved/preroll/(motion_[0-9]{13}[.]mp4)',path)
   if m:return self.archive(m.group(1),'/saved/preroll/'+m.group(2),head)
"""
NAME="motion_1791910606764.mp4"
def h(p):return hashlib.sha256(p).hexdigest()
def atomic(raw,st):
 fd,tmp=tempfile.mkstemp(prefix=".s9-preroll-relay-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode))
  try:os.chown(tmp,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(tmp,TARGET)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def request(method,filename,range_=False):
 q=urllib.request.Request("http://127.0.0.1:8794/new/saved/preroll/"+filename,
                         method=method,headers={"Range":"bytes=0-127"} if range_ else {})
 try:
  with urllib.request.urlopen(q,timeout=24) as r:
   return r.status,r.headers,(r.read(128) if method=="GET" else b"")
 except urllib.error.HTTPError as e:return e.code,e.headers,e.read(200)
def restart():
 x=subprocess.run(["systemctl","--user","restart",SERVICE],capture_output=True,text=True,timeout=50)
 if x.returncode:raise RuntimeError("restart_failed:"+x.stderr[-180:])
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("unknown_relay_target")
 before=TARGET.read_bytes()
 txt=before.decode()
 if txt.count(ANCHOR)!=1 or "S9_PREROLL_SIGNED_READONLY_V1" in txt:
  raise RuntimeError("relay_source_changed")
 modified=txt.replace(ANCHOR,INSERT+ANCHOR,1).encode()
 compile(modified.decode(),str(TARGET),"exec")
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 saved=folder/TARGET.name;saved.write_bytes(before);os.chmod(saved,0o600)
 if h(saved.read_bytes())!=h(before):raise RuntimeError("backup_not_verified")
 st=TARGET.stat()
 try:
  if TARGET.read_bytes()!=before:raise RuntimeError("concurrent_source_change")
  atomic(modified,st)
  restart()
  outcome=None
  for retry in range(12):
   try:
    head,headers,_=request("HEAD",NAME)
    get,headers,data=request("GET",NAME,True)
    invalid,_,_=request("HEAD","motion_1791910606764.mp4.preroll.mp4")
    if head==200 and get==206 and b"ftyp" in data and invalid==404:
     outcome={"head":head,"range":get,"size":int(headers.get("Content-Length","0")),
              "mime":headers.get("Content-Type"),"invalid_path_denied":True,
              "backup":str(saved),"media_modified":False}
     break
   except Exception:time.sleep(.5)
  if outcome is None:raise RuntimeError("preroll_route_not_verified")
  print("S9_PREROLL_AUTHENTICATED_ROUTE_DEPLOYED",json.dumps(outcome,sort_keys=True),flush=True)
 except BaseException:
  atomic(before,st)
  try:restart()
  except Exception:pass
  print("S9_PREROLL_SIGNED_ROUTE_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
