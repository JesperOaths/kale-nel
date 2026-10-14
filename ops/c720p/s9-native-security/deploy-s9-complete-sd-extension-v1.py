#!/usr/bin/env python3
"""Safely fix S9 archive complete-clip playback inside the existing SD handler.

Also fixes a pre-existing local-variable collision that made unrelated
archive routes throw UnboundLocalError on fallback. Tests via a shadow
archive server BEFORE restarting the live listener, preserving backups.
"""
from pathlib import Path
import datetime,os,subprocess,tempfile,time,urllib.request,json
BASE=Path("/home/jespern/c720p-home-hub")
DIR=BASE/"bin"
PLUGIN=DIR/"s9_sd_proxy_extension.py"
HELPER=DIR/"s9_merged_archive_stream_v1.py"
ARCHIVE=DIR/"c720p-drive-security-archive.py"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/cbbc6a40706fb2483b59794c94df74a208f67ba5/ops/c720p/s9-native-security/s9_merged_archive_stream_v1.py"
MARKER="S9_COMPLETE_RANGE_PROOF_V1"
NAME="motion_1791934137487.mp4"
def run(*args,timeout=30):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed:"+str(args[:4])+":"+p.stderr[-350:])
 return p.stdout
def replace(p,raw,mode):
 fd,temp=tempfile.mkstemp(prefix=".s9range-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(temp,mode);os.replace(temp,p)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def verify(port):
 req=urllib.request.Request(f"http://127.0.0.1:{port}/new/saved/complete/"+NAME,method="HEAD")
 with urllib.request.urlopen(req,timeout=36) as r:
  if r.status!=200 or int(r.headers.get("Content-Length","0"))!=6438237:
   raise RuntimeError("combined_media_head_failed_"+str(port))
 ranged=urllib.request.Request(f"http://127.0.0.1:{port}/new/saved/complete/"+NAME,
     headers={"Range":"bytes=0-4095"})
 with urllib.request.urlopen(ranged,timeout=26) as r:
  chunk=r.read(4096)
  if r.status!=206 or len(chunk)!=4096 or chunk[4:8]!=b"ftyp":
   raise RuntimeError("range_seek_not_correct_"+str(port))
def main():
 old=PLUGIN.read_bytes();src=old.decode()
 if MARKER in src:
  print("S9_ARCHIVE_EXTENSION_VERIFIED_ROUTE_ALREADY_PRESENT")
  verify(8795);verify(8794)
  return
 target="original=joined.group(1);record=data.get(original)"
 nextline='nm=original+".complete.mp4"'
 if src.count(target)!=1 or src.count(nextline)!=1:
  raise RuntimeError("unexpected_archive_extension_joined_branch")
 src=src.replace(target,"clip_name=joined.group(1);record=data.get(clip_name)")
 src=src.replace(nextline,'nm=clip_name+".complete.mp4"')
 hook='    nm=clip_name+".complete.mp4"'
 nl="\r\n" if b"\r\n" in old else "\n"
 lines=[
  "    # "+MARKER+": no unverified on-phone transcode is served.",
  "    from s9_merged_archive_stream_v1 import receipt as _s9_receipt, serve_complete as _s9_serve",
  "    if _s9_receipt(clip_name):return _s9_serve(self,clip_name)"
 ]
 if src.count(hook)!=1:raise RuntimeError("hook_placement_invalid")
 src=src.replace(hook,nl.join(lines)+nl+hook)
 compile(src,str(PLUGIN),"exec")
 with urllib.request.urlopen(URL,timeout=35) as r:body=r.read(12000)
 helper=body.decode()
 if not all(x in helper for x in ("serve_complete","both_segments_decoded","Content-Range")):
  raise RuntimeError("untrusted_helper")
 compile(helper,str(HELPER),"exec")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BASE/"backups/s9-archive-range-plugin-v1"/stamp
 backup.mkdir(parents=True,exist_ok=True)
 (backup/PLUGIN.name).write_bytes(old)
 oldhelper=HELPER.read_bytes() if HELPER.is_file() else None
 if oldhelper is not None:(backup/HELPER.name).write_bytes(oldhelper)
 shadow=DIR/"s9-complete-archive-shadow-v1.py"
 if shadow.exists():raise RuntimeError("shadow_server_file_already_exists")
 process=None
 try:
  replace(HELPER,body,0o700)
  replace(PLUGIN,src.encode(),0o644)
  main_src=ARCHIVE.read_text()
  footer="int(c.get('listen_port',8795))"
  if main_src.count(footer)!=1:raise RuntimeError("shadow_archive_port_unexpected")
  shadow.write_text(main_src.replace(footer,"18818"))
  process=subprocess.Popen(["/usr/bin/python3",str(shadow)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  time.sleep(5)
  if process.poll() is not None:
   raise RuntimeError("shadow_archive_failed_to_start_"+process.stderr.read(1300).decode("utf-8","replace"))
  verify(18818)
  process.terminate()
  try:process.wait(timeout=10)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
  process=None
  shadow.unlink(missing_ok=True)
  run("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=35)
  for check in range(30):
   try:
    verify(8795)
    break
   except (OSError,ConnectionError):
    if check==29:raise
    time.sleep(0.6)
  verify(8794)
  print("S9_COMPLETE_MP4_AUTHENTICATED_RANGE_PRODUCTION_LIVE",
   json.dumps({"verified":True,"file":NAME,"bytes":6438237,
   "archive_endpoint":8795,"authenticated_ha_endpoint":8794,
   "original_recordings_untouched":True,
   "fixed_preexisting_unboundlocalerror":True,
   "rollback":str(backup)}),flush=True)
 except BaseException:
  replace(PLUGIN,old,0o644)
  if oldhelper is None:
   HELPER.unlink(missing_ok=True)
  else:replace(HELPER,oldhelper,0o700)
  try:run("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=35)
  except Exception:pass
  raise
 finally:
  if process and process.poll() is None:
   process.terminate()
   try:process.wait(timeout=8)
   except subprocess.TimeoutExpired:process.kill()
  shadow.unlink(missing_ok=True)
if __name__=="__main__":main()
