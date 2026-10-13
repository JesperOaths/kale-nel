#!/usr/bin/env python3
"""Fail-open Security video playback v31 for every tab, with safe backups.

If a browser asks for a smooth 360p rendition that is delayed or unavailable,
load the original signed range-capable MP4 instead of leaving the player empty.
Keeps the optional smooth/Retry path and original 4K media unchanged.
"""
from pathlib import Path
import datetime,json,os,subprocess,re,stat,tempfile,urllib.request,hashlib
BASE=Path("/opt/homeassistant/config/www")
PAGES=BASE/"frontyard-security-new"
JSS=(BASE/"security-video-playback.js",PAGES/"security-video-playback-v30.js")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-video-failopen-v31")
MARK="security-video-failopen-v31-20261013"
OLD_CATCH=""" }catch(error){
  if(generation!==state.generation||abort.signal.aborted)return;
  state.pending=false;state.failed=true;state.message=String(error.message||error).slice(0,150)+(state.sourceLowFps?' · choose Original':' · Retry or choose Original');renderState(state);
 }"""
NEW_CATCH=""" }catch(error){
  if(generation!==state.generation||abort.signal.aborted)return;
  // SECURITY_VIDEO_FAILOPEN_V31: do not leave the viewer empty when the
  // optional low-CPU transcode cannot be prepared. Signed original playback
  // remains available, with visible Retry for the smooth copy.
  state.pending=false;state.failed=true;
  const cause=String(error?.message||error).slice(0,90);
  state.message='Smooth copy unavailable · opening original recording…';renderState(state);
  try{
   const original=await relay().url(path);
   if(generation!==state.generation||abort.signal.aborted)return;
   state.mode='original';
   video.dataset.securityProfile='original-fallback';
   mediaSrc.set.call(video,original);
   nativeLoad.call(video);
   state.message='Original recording · smooth copy unavailable ('+cause+') · use Retry for smooth playback';
   renderState(state);
   if(state.wantPlay){
    try{await nativePlay.call(video)}
    catch(_){state.message='Original recording ready · press Play';renderState(state)}
   }
  }catch(fallback){
   if(generation!==state.generation||abort.signal.aborted)return;
   state.message='Playback unavailable: '+String(fallback?.message||fallback).slice(0,105)+' · press Retry';
   renderState(state);
  }
 }"""
def digest(raw):return hashlib.sha256(raw).hexdigest()
def atom(p,data,mode,owner):
 fd,t=tempfile.mkstemp(prefix=".security-video-v31-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(t,mode)
  try:os.chown(t,*owner)
  except PermissionError:pass
  os.replace(t,p)
 finally:
  if os.path.exists(t):os.unlink(t)
def main():
 found={}
 for p in JSS:
  if not p.is_file() or p.is_symlink():raise RuntimeError("missing_playback_library_"+p.name)
  text=p.read_text()
  if text.count(OLD_CATCH)!=1 or "const deadline=Date.now()+660000;" not in text:
   raise RuntimeError("unexpected_player_script_"+p.name)
  new=text.replace(OLD_CATCH,NEW_CATCH,1).replace(
    "const deadline=Date.now()+660000;","const deadline=Date.now()+8000;",1)
  new="/* "+MARK+" */\n"+new
  found[p]=new.encode()
 # Refresh the versioned script URLs in every page that loads a player.
 candidates=[BASE/"c720p-surveillance.html",*PAGES.glob("*.html")]
 changed_refs=[]
 for p in candidates:
  if p.is_symlink() or p in found or not p.is_file():continue
  s=p.read_text()
  if "security-video-playback" not in s:continue
  # Match existing script references, avoiding unrelated URL/site text.
  regex=r'(security-video-playback(?:-v30)?[.]js)(?:[?]v=[A-Za-z0-9._-]+)?'
  modified,n=re.subn(regex,lambda m:m.group(1)+"?v="+MARK,s)
  if n:
   if "security-video-playback" not in modified:raise RuntimeError("lost_script_reference")
   found[p]=modified.encode();changed_refs.append((p.name,n))
 if not changed_refs:raise RuntimeError("no_HTML_includes_found")
 # v30 must be an actual existing include; otherwise do not update.
 if BASE.joinpath("c720p-surveillance.html") not in found:
  raise RuntimeError("v30_shell_script_cache_version_not_updated")
 modes={};old={}
 for p,data in found.items():
  if not data or len(data)>300000:raise RuntimeError("unexpected_page_size")
  old[p]=p.read_bytes();modes[p]=p.stat()
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder.mkdir(mode=0o700)
 for p,raw in old.items():
  file=folder/p.relative_to(BASE);file.parent.mkdir(parents=True,exist_ok=True)
  file.write_bytes(raw);os.chmod(file,0o600)
  if digest(file.read_bytes())!=digest(raw):raise RuntimeError("unverified_backup")
 # Validate JS source before changing files (node is an optional validator).
 binary=subprocess.run(["which","node"],capture_output=True,text=True,timeout=5).stdout.strip()
 if binary:
  with tempfile.TemporaryDirectory(prefix="s9-js-parse-v31-") as td:
   for i,p in enumerate(JSS):
    test=Path(td)/(str(i)+".js");test.write_bytes(found[p])
    v=subprocess.run([binary,"--check",str(test)],capture_output=True,text=True,timeout=10)
    if v.returncode:raise RuntimeError("js_syntax_invalid_"+p.name+":"+v.stderr[-400:])
 written=[]
 try:
  for p,raw in found.items():
   if p.read_bytes()!=old[p]:raise RuntimeError("concurrent_page_edit_"+p.name)
   st=modes[p]
   atom(p,raw,stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid));written.append(p)
  for p,data in found.items():
   uri="http://127.0.0.1:8123/local/"+p.relative_to(BASE).as_posix()+"?v="+MARK
   with urllib.request.urlopen(uri,timeout=22) as r:served=r.read(300001)
   if digest(served)!=digest(data):raise RuntimeError("HA_script_http_readback_mismatch_"+p.name)
  print("SECURITY_VIDEO_FAILOPEN_V31_DEPLOYED",json.dumps({
   "files":[p.relative_to(BASE).as_posix() for p in found],
   "includes":changed_refs,"backup":str(folder),"delay_to_original_ms":8000,
   "javascript_compiled":bool(binary),"http_verified":True,"recordings_unchanged":True},sort_keys=True),flush=True)
 except BaseException:
  for p in reversed(written):
   st=modes[p]
   try:atom(p,old[p],stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid))
   except Exception as err:print("ROLLBACK_ERROR",p.name,str(err)[:100],flush=True)
  raise
if __name__=="__main__":main()
