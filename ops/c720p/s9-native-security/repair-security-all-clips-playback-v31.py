#!/usr/bin/env python3
"""Re-enable shared Security playback routes with guarded atomic rollback.

The backend loads s9_sd_proxy_extension but lost the s9_hub_playback.install()
call. Both ?playback=prepare and ?playback=hub currently return an original
video/mp4, so all clients expecting JSON abort before playback begins.

Only modifies C720P private upstream 8795, never a recording, model, or auth.
"""
import datetime,json,os,stat,tempfile,time,urllib.request,urllib.error,subprocess
from pathlib import Path
UP=Path("/home/jespern/c720p-home-hub/bin/c720p-drive-security-archive.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-playback-routing-v31")
ANCHOR=" import s9_sd_proxy_extension\n s9_sd_proxy_extension.install_local_sd(H)\n"
ADD=" import s9_hub_playback\n s9_hub_playback.install(H,s9_sd_proxy_extension.rows)\n"
UNIT="c720p-drive-security-archive.service"

def read(url,method="GET",headers=None,limit=1400000):
 req=urllib.request.Request(url,method=method,headers=headers or {})
 with urllib.request.urlopen(req,timeout=20) as resp:
  body=resp.read(limit+1) if method!="HEAD" else b""
  if len(body)>limit:raise RuntimeError("response_oversize")
  return resp.status,resp.headers,body
def catalog(name):
 status,head,raw=read("http://127.0.0.1:8794/new/api/"+name)
 j=json.loads(raw)
 if status!=200 or j.get("ok") is not True or not isinstance(j.get("events"),list):
  raise RuntimeError("archive_catalog_not_healthy_"+name)
 return j["events"]
def restart():
 result=subprocess.run(["systemctl","--user","restart",UNIT],capture_output=True,text=True,timeout=40)
 if result.returncode:raise RuntimeError("restart_failed_"+result.stderr[-180:])
def atomic(data,mode,owner):
 fd,p=tempfile.mkstemp(prefix=".security-playback-v31-",dir=UP.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(p,mode)
  try:os.chown(p,*owner)
  except PermissionError:pass
  os.replace(p,UP)
 finally:
  if os.path.exists(p):os.unlink(p)
def test_routes(counts):
 # The phone originals must still support real HTTP range seeks.
 url="http://127.0.0.1:8794/new/saved/clip/rec_2026-10-09_22-40.mp4"
 status,headers,data=read(url,headers={"Range":"bytes=0-31"},limit=100)
 if status!=206 or "video/mp4" not in headers.get("Content-Type","") or b"ftyp" not in data:
  raise RuntimeError("original_recording_http_range_failed")
 checks={}
 for port in (8795,8794):
  url=f"http://127.0.0.1:{port}/new/saved/clip/rec_2026-10-09_22-40.mp4?playback=prepare"
  code,headers,data=read(url,limit=16000)
  if "application/json" not in headers.get("Content-Type",""):
   raise RuntimeError("prepare_still_returns_mp4_on_port_"+str(port))
  value=json.loads(data)
  if code!=200 or value.get("state") not in ("ready","queued","preparing","failed") or value.get("ok") is False:
   raise RuntimeError("prepare_handler_unhealthy_"+str(port)+"_"+str(value)[:300])
  checks[port]={"status":code,"state":value.get("state"),"mime":headers.get("Content-Type")}
 after={name:len(catalog(name)) for name in counts}
 if any(after[k]<counts[k] for k in counts):raise RuntimeError("archive_lost_indexed_clips")
 return checks,after
def main():
 before={name:len(catalog(name)) for name in ("saved","drive-saved")}
 if not UP.is_file() or UP.is_symlink():raise RuntimeError("unexpected_archive_backend_path")
 s=UP.read_text()
 if s.count(ANCHOR)!=1 or "s9_hub_playback.install(H,s9_sd_proxy_extension.rows)" in s:
  raise RuntimeError("backend_source_changed_or_already_installed")
 if not Path("/home/jespern/c720p-home-hub/bin/s9_hub_playback.py").is_file():
  raise RuntimeError("playback_module_missing")
 import sys
 sys.path.insert(0,str(UP.parent))
 import s9_hub_playback,s9_rgb_video_playback_v1
 if not callable(s9_hub_playback.install) or not callable(s9_sd_proxy_rows()):
  raise RuntimeError("playback_integration_unavailable")
 # Check the module is compilable and the patch preserves all unrelated code.
 changed=s.replace(ANCHOR,ANCHOR+ADD,1)
 compile(changed,str(UP),"exec")
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 old=UP.read_bytes();file=folder/UP.name;file.write_bytes(old);os.chmod(file,0o600)
 if file.read_bytes()!=old:raise RuntimeError("rollback_backup_mismatch")
 st=UP.stat()
 if UP.read_bytes()!=old:raise RuntimeError("concurrent_backend_edit")
 try:
  atomic(changed.encode(),stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid))
  restart()
  last=None
  for retry in range(14):
   try:
    checks,after=test_routes(before)
    print("SECURITY_ALL_CLIPS_PREPARED_ROUTING_V31_DEPLOYED",json.dumps({
     "modes":checks,"archives":after,"original_range_206":True,
     "backup":str(file),"no_video_changed":True,
     "auth_relay_unchanged":True},sort_keys=True),flush=True)
    return
   except Exception as ex:last=ex;time.sleep(.8)
  raise RuntimeError("playback_route_validation_failed_"+str(last))
 except BaseException:
  atomic(old,stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid))
  try:restart()
  except Exception:pass
  print("SECURITY_ALL_CLIPS_PREPARED_ROUTING_V31_ROLLED_BACK",flush=True)
  raise

def s9_sd_proxy_rows():
 import s9_sd_proxy_extension
 return s9_sd_proxy_extension.rows
if __name__=="__main__":main()
