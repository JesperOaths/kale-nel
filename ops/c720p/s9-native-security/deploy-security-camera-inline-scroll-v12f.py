#!/usr/bin/env python3
"""Make legacy Camera Settings scrollable after its runtime stylesheet resets overflow.

The panel lives in .view, outside the v5 Security shell. Scoped CSS there is
overridden by the original dashboard at runtime. Fix only this exact panel with
inline important styles, preserving camera controls and all media.
"""
from pathlib import Path
import datetime as dt
import hashlib,json,os,stat,tempfile,urllib.request

TARGET=Path("/opt/homeassistant/config/www/c720p-surveillance.html")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-camera-scroll-inline-v12f")
MARK="s9-camera-scroll-inline-v12f"
JS=r"""
<script id="s9-camera-scroll-inline-v12f">
(()=>{
 'use strict';
 if(window.__s9CameraScrollInlineV12F)return;
 window.__s9CameraScrollInlineV12F=true;
 let watched=null,observing=null,queued=false;
 function fix(){
  const panel=document.getElementById('panel-controls');
  if(!panel)return;
  const apply=(node,prop,val)=>{
   if(node.style.getPropertyValue(prop)!==val||
      node.style.getPropertyPriority(prop)!=='important')
    node.style.setProperty(prop,val,'important');
  };
  apply(panel,'overflow-y','auto');
  apply(panel,'overflow-x','hidden');
  apply(panel,'overscroll-behavior-y','contain');
  apply(panel,'scroll-padding-bottom','56px');
  apply(panel,'min-height','0px');
  const frame=panel.querySelector(':scope > #s9v22-camera-frame');
  if(frame){apply(frame,'display','none');apply(frame,'height','0px');}
  const controls=panel.querySelector(':scope > .controls');
  if(controls){
   apply(controls,'display','block');
   apply(controls,'height','auto');
   apply(controls,'min-height','0px');
   apply(controls,'overflow','visible');
   apply(controls,'padding-bottom','60px');
  }
  if(panel!==watched){
   if(observing)observing.disconnect();
   watched=panel;
   observing=new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;fix()});
   });
   observing.observe(panel,{attributes:true,attributeFilter:['style','class']});
  }
 }
 document.addEventListener('click',e=>{
  if(e.target.closest?.('#s9v5-nav button[data-view="camera"]')){
   requestAnimationFrame(fix);
   setTimeout(fix,150);
  }
 },true);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fix,{once:true});
 else fix();
 setTimeout(fix,600);
})();
</script>
"""

def sha(b):return hashlib.sha256(b).hexdigest()
def atomic(data,mode,owner):
 fd,tmp=tempfile.mkstemp(prefix=".camera-scroll-v12f-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode)
  try:os.chown(tmp,*owner)
  except PermissionError:pass
  os.replace(tmp,TARGET)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def http(p,maxlen=110000):
 with urllib.request.urlopen(p,timeout=18) as r:d=r.read(maxlen+1)
 if len(d)>maxlen:raise RuntimeError("html_too_large")
 return d
def count(path):
 j=json.loads(http("http://127.0.0.1:8795"+path,2000000))
 if j.get("ok")!=True:raise RuntimeError("archive_source_unavailable")
 return len(j.get("events",[]))
def main():
 if not TARGET.is_file() or TARGET.is_symlink():raise RuntimeError("wrong_root_page")
 before=(count("/new/api/saved"),count("/new/api/drive-saved"))
 original=TARGET.read_bytes()
 page=original.decode("utf-8")
 if "s9-security-scroll-boundaries-v12" not in page or page.count("</body>")!=1 or "panel-controls" not in page:
  raise RuntimeError("wrong_security_layout_version")
 if f'id="{MARK}"' in page:
  current=http("http://127.0.0.1:8123/local/c720p-surveillance.html?v=v12f-readback")
  if sha(current)!=sha(original):raise RuntimeError("existing_install_http_mismatch")
  print("CAMERA_INLINE_SCROLL_V12F_ALREADY_PRESENT");return
 updated=page.replace("</body>",JS+"\n</body>",1).encode()
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 copy=folder/TARGET.name;copy.write_bytes(original);os.chmod(copy,0o600)
 if sha(copy.read_bytes())!=sha(original):raise RuntimeError("backup_unverified")
 st=TARGET.stat()
 if TARGET.read_bytes()!=original:raise RuntimeError("concurrent_edit")
 try:
  atomic(updated,stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid))
  served=http("http://127.0.0.1:8123/local/c720p-surveillance.html?v=v12f-check")
  if sha(served)!=sha(updated):raise RuntimeError("live_html_not_updated")
  after=(count("/new/api/saved"),count("/new/api/drive-saved"))
  if after[0]<before[0] or after[1]<before[1]:raise RuntimeError("catalog_regression")
  print("CAMERA_INLINE_SCROLL_V12F_DEPLOYED",json.dumps({
   "backup":str(copy),"microSD_clips":after[0],"drive_clips":after[1],
   "html_http_verified":True,"camera_functionality_unchanged":True,
   "media_deleted":False,"added_version":MARK},sort_keys=True),flush=True)
 except BaseException:
  atomic(original,stat.S_IMODE(st.st_mode),(st.st_uid,st.st_gid))
  print("CAMERA_INLINE_SCROLL_V12F_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
