#!/usr/bin/env python3
"""Security Live V3 retry guard. Prevent C720P's 1 Hz tab polling bypassing backoff."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,os,shutil,tempfile,json,hashlib
WWW=Path("/opt/homeassistant/config/www")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-live-stability")
JS="security-video-playback.js";PAGE="c720p-surveillance.html"
OLD='if(state.running||!state.wanted||!visible(state.img))return;'
NEW='if(state.running||state.retryTimer||!state.wanted||!visible(state.img))return;'
TAG="C720P_SECURITY_NATIVE_MJPEG_STABLE_V2"
QOLD="security-video-playback.js?v=C720P_SECURITY_NATIVE_MJPEG_STABLE_V2_20261011"
QNEW="security-video-playback.js?v=C720P_SECURITY_NATIVE_MJPEG_STABLE_V3_20261011"
def upgrade(root,backup_root,apply=False):
 paths=[root/JS,root/PAGE]
 if not all(p.is_file() and not p.is_symlink() for p in paths):raise RuntimeError("missing_live_assets")
 js,html=[p.read_text() for p in paths]
 if js.count(TAG)!=1 or "imageSrc.set.call(img,signed)" not in js:raise ValueError("unexpected_native_mjpeg_script")
 if NEW in js and QNEW in html and OLD not in js and QOLD not in html:
  return {"already_installed":True}
 if js.count(OLD)!=1 or html.count(QOLD)!=1 or NEW in js or QNEW in html:
  raise ValueError("unknown_partial_live_version")
 changed={paths[0]:js.replace(OLD,NEW,1),paths[1]:html.replace(QOLD,QNEW,1)}
 if not apply:return {"dry_run":True,"assets":[p.name for p in paths],"backoff_guard":True}
 backup=backup_root/datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,exist_ok=False);os.chmod(backup,0o700)
 written=[]
 try:
  for p in paths:
   shutil.copy2(p,backup/p.name);os.chmod(backup/p.name,0o600)
  for p in paths:
   fd,name=tempfile.mkstemp(prefix=".s9-live-retry-",dir=p.parent);os.close(fd);t=Path(name)
   try:
    t.write_text(changed[p]);st=p.stat();os.chmod(t,st.st_mode&0o777)
    try:os.chown(t,st.st_uid,st.st_gid)
    except PermissionError:pass
    if t.read_text()!=changed[p]:raise RuntimeError("stage")
    os.replace(t,p);written.append(p)
   finally:t.unlink(missing_ok=True)
  if not all(p.read_text()==changed[p] for p in paths):raise RuntimeError("readback")
 except BaseException:
  for p in reversed(written):
   fd,name=tempfile.mkstemp(prefix=".s9-retry-rollback-",dir=p.parent);os.close(fd);t=Path(name)
   try:shutil.copy2(backup/p.name,t);os.replace(t,p)
   finally:t.unlink(missing_ok=True)
  raise
 return {"deployed":True,"backup":str(backup),"sha256":{p.name:hashlib.sha256(changed[p].encode()).hexdigest() for p in paths},
         "recordings_modified":False,"camera_modified":False}
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--root",type=Path,default=WWW)
 p.add_argument("--backup-root",type=Path,default=BACKUP)
 p.add_argument("--apply",action="store_true")
 a=p.parse_args();print("S9_LIVE_RETRY_V3",json.dumps(upgrade(a.root,a.backup_root,a.apply),sort_keys=True),flush=True)
