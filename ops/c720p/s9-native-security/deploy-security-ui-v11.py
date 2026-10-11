#!/usr/bin/env python3
"""Fix Security navigation, native telemetry presentation and Tracks pagination.

Patch only the locally-installed Security shell and Tracks HTML. The Tracks
template is pinned to this immutable Git commit and SHA-256. No phone, media,
camera settings, archive catalog, service or credentials are changed.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

WWW=Path("/opt/homeassistant/config/www")
ROOT=WWW/"c720p-surveillance.html"
TRACKS=WWW/"frontyard-security-new/security-tracks-v7.html"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-ui-v11")
UPSTREAM="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
TEMPLATE="ops/c720p/s9-native-security/security-tracks-v7.html"

STYLE = r"""
<style id="s9-security-settings-v11">
/* Camera settings must show controls, not a copy of the recordings browser. */
#s9v5-shell #panel-controls{overflow-y:auto!important;min-height:0!important;padding:clamp(16px,2vw,26px)!important;background:#0e1721!important}
#s9v5-shell #panel-controls>.controls{max-width:1150px!important;display:block!important;margin:0 auto!important}
#s9v5-shell #panel-controls .controlcam{padding:clamp(18px,2vw,28px)!important;background:#142532!important;border:1px solid #385164!important;border-radius:16px!important;min-width:0!important}
#s9v5-shell #panel-controls .controlcam>h2{margin:0 0 18px!important;font-size:21px!important;font-weight:800!important}
#s9v5-shell #panel-controls #cameraControls{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr))!important;gap:14px!important;align-items:start}
#s9v5-shell #panel-controls #cameraControls>*{min-width:0!important;max-width:100%!important}
#s9v5-shell #panel-controls #cameraControlMsg{margin:15px 0 0!important;line-height:1.5!important;white-space:normal!important}
#s9v5-shell .s9v5-rail-card .s9v5-readout{min-width:0}
#s9v5-shell .s9v5-rail-card .s9v5-readout b{text-align:right;overflow-wrap:anywhere}
#s9v5-shell #panel-live .s9v5-live-rail{min-width:250px!important}
#s9v5-shell #panel-live .s9v5-live-stage-heading strong{font-weight:780}
@media(max-width:900px){#s9v5-shell #panel-live .s9v5-live-rail{min-width:0!important}}
</style>
"""

SCRIPT = r"""
<script id="s9-security-live-status-v11">
(()=>{
 'use strict';
 if(window.__s9SecurityStatusV11)return;
 window.__s9SecurityStatusV11=true;
 const pick=id=>document.getElementById(id);
 const set=(id,value)=>{const el=pick(id);if(el)el.textContent=String(value)};
 const pretty=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?(n/(1024**3)).toFixed(1)+' GB':'Unavailable'};
 let lastHealthy=0,busy=false,failures=0;
 async function refresh(){
  if(document.hidden||busy||!pick('s9v5-shell'))return;
  const api=window.C720PSecureRelay;
  if(!api||typeof api.fetch!=='function'){
   set('s9v5-status-label','Telemetry not connected');
   set('s9v5-side-health','Camera stream independent · telemetry unavailable');
   return;
  }
  busy=true;
  try{
   const [personResult,archiveResult]=await Promise.allSettled([
    api.fetch('/new/api/live-person-watch',{cache:'no-store'}),
    api.fetch('/new/api/saved',{cache:'no-store'})
   ]);
   if(personResult.status!=='fulfilled'||!personResult.value.ok)throw Error('camera_telemetry_unavailable');
   const d=await personResult.value.json();
   const age=Number(d.last_sample_age_ms);
   const fresh=d.ok===true&&(d.camera_mode==='watching'||d.camera_mode==='recording')&&
    (d.last_sample_age_ms==null||(Number.isFinite(age)&&age>=0&&age<45000));
   if(!fresh)throw Error('camera_telemetry_stale');
   lastHealthy=Date.now();failures=0;
   const mode=d.camera_mode==='recording'?'Recording':'Watching';
   const temp=Number(d.camera_temperature_c);
   set('s9v5-status-label','S9+ online');
   set('s9v5-side-health','Native Camera2 · '+mode.toLowerCase());
   set('s9v5-rail-mode',mode);
   set('s9v5-rail-temp',Number.isFinite(temp)&&temp>=0&&temp<85?temp.toFixed(1)+' °C':'Unavailable');
   const fps=Number(d.camera_sensor?.fps);
   let diagnostic='On-phone detector · '+(d.person_inference_ready?'active':'status unverified');
   if(Number.isFinite(fps)&&fps>0&&fps<=120)diagnostic+=' · sensor '+fps.toFixed(1)+' FPS';
   if(Number.isFinite(age)&&age>=0)diagnostic+=' · sample '+Math.round(age/1000)+'s old';
   set('s9v11-diagnostic',diagnostic);
   for(const id of ['s9v5-status-dot','s9v5-side-dot']){const el=pick(id);if(el)el.dataset.state=el.dataset.health='ok'}
   if(archiveResult.status==='fulfilled'&&archiveResult.value.ok){
    const catalog=await archiveResult.value.json();
    if(catalog.archive_mode==='S9-microSD-only'&&Array.isArray(catalog.events)){
     const available=d.sd_free_bytes??d.microSD_free_bytes??catalog.sd_free_bytes;
     set('s9v5-rail-sd',available!=null?pretty(available):'Connected · '+catalog.events.length+' clips');
    }
   }
  }catch(e){
   failures++;
   if(Date.now()-lastHealthy>60000){
    set('s9v5-status-label','Telemetry unavailable');
    set('s9v5-side-health','Camera status not confirmed · retrying');
    set('s9v5-rail-mode','Not verified');
    set('s9v11-diagnostic','Status update unavailable · retrying automatically');
    for(const id of ['s9v5-status-dot','s9v5-side-dot']){const el=pick(id);if(el)el.dataset.state=el.dataset.health='unknown'}
   }
  }finally{busy=false}
 }
 function mount(){
  const rail=pick('s9v5-rail-mode')?.closest('.s9v5-rail-card');
  if(rail&&!pick('s9v11-diagnostic')){
   const el=document.createElement('p');el.id='s9v11-diagnostic';el.style.marginTop='12px';
   el.style.fontSize='12px';el.style.color='#adc7d4';el.textContent='Checking on-phone camera telemetry…';
   rail.append(el);
  }
 }
 let tries=0;
 const boot=setInterval(()=>{mount();if(pick('s9v5-shell')){clearInterval(boot);refresh()}else if(++tries>50)clearInterval(boot)},200);
 setInterval(()=>{mount();refresh()},12000);
 window.addEventListener('pageshow',refresh);
})();
</script>
"""

def sha(data):return hashlib.sha256(data).hexdigest()
def retrieve(url,limit,timeout=25):
 with urllib.request.urlopen(url,timeout=timeout) as r:
  if r.status!=200:raise RuntimeError("unexpected_http_status")
  data=r.read(limit+1)
 if len(data)>limit:raise RuntimeError("unbounded_download")
 return data
def require_once(src,old,new,what):
 if src.count(old)!=1:raise RuntimeError("unexpected_"+what+"_source")
 return src.replace(old,new,1)
def atomically(path,data,old_stat):
 fd,tmp=tempfile.mkstemp(prefix=".security-ui-v11-",suffix=".html",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as handle:
   handle.write(data);handle.flush();os.fsync(handle.fileno())
  os.chmod(tmp,stat.S_IMODE(old_stat.st_mode))
  try:os.chown(tmp,old_stat.st_uid,old_stat.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--ref',required=True)
 p.add_argument('--sha256',required=True)
 args=p.parse_args()
 if not re.fullmatch(r'[a-f0-9]{40}',args.ref) or not re.fullmatch(r'[a-f0-9]{64}',args.sha256):
  raise RuntimeError("invalid_pinned_source")
 for file in (ROOT,TRACKS):
  if file.is_symlink() or not file.is_file():raise RuntimeError("missing_or_untrusted_security_page")
 original={x:x.read_bytes() for x in (ROOT,TRACKS)}
 modes={x:x.stat() for x in (ROOT,TRACKS)}
 template=retrieve(UPSTREAM+args.ref+'/'+TEMPLATE,120000)
 if sha(template)!=args.sha256:raise RuntimeError("tracks_template_hash_invalid")
 t=template.decode('utf-8')
 for needed in ("#more[hidden]","const remaining=Math.max(0,entries.length-visible);",
                "resetFilteredScroll();","'person':'people'"):
  if needed not in t:raise RuntimeError("tracks_regression_contract_missing")
 root=original[ROOT].decode("utf-8")
 if 'id="s9-security-settings-v11"' in root:
  if original[TRACKS]==template:
   print("SECURITY_UI_V11_ALREADY_INSTALLED",flush=True);return
  raise RuntimeError("mixed_security_ui_revision")
 root=require_once(root,"const shown=panel.id==='panel-'+name || (name==='archive'&&panel.id==='panel-saved');",
    "const shown=panel.id==='panel-'+(name==='camera'?'controls':name) || (name==='archive'&&panel.id==='panel-saved');","camera_panel_route")
 root=require_once(root,"const base=(id==='archive'||id==='overview')?'saved':id;",
    "const base=id==='camera'?'controls':(id==='archive'||id==='overview')?'saved':id;","camera_nav_route")
 root=require_once(root,"</head>",STYLE+"</head>","css_insertion")
 root=require_once(root,"</body>",SCRIPT+"</body>","telemetry_insertion")
 if not all(x in root for x in ('id="panel-controls"','C720PSecureRelay','id="s9v5-command-script"')):
  raise RuntimeError("security_root_contract_incomplete")
 result={ROOT:root.encode('utf-8'),TRACKS:template}
 BACKUP.mkdir(parents=True,exist_ok=True)
 os.chmod(BACKUP,0o700)
 folder=BACKUP/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 for file in (ROOT,TRACKS):
  b=folder/file.name
  b.write_bytes(original[file]);os.chmod(b,0o600)
  if b.read_bytes()!=original[file]:raise RuntimeError("rollback_backup_failed")
 changed=[]
 try:
  for file in (ROOT,TRACKS):
   atomically(file,result[file],modes[file]);changed.append(file)
  for file in (ROOT,TRACKS):
   url="http://127.0.0.1:8123/local/"+file.relative_to(WWW).as_posix()+"?v=security-ui-v11"
   remote=retrieve(url,120000,15)
   if sha(remote)!=sha(result[file]):
    raise RuntimeError("home_assistant_page_readback_failed_"+file.name)
  print("SECURITY_UI_V11_VERIFIED "+json.dumps({
   "camera_settings_target":"panel-controls","tracks_pagination":"nonnegative_and_hidden_correctly",
   "native_health_poll_seconds":12,"tracks_sha256":args.sha256,
   "backup":str(folder),"pages_verified":2,"video_changed":False,"camera_changed":False,
   "archive_catalog_changed":False}),flush=True)
 except BaseException:
  for file in reversed(changed):
   try:atomically(file,original[file],modes[file])
   except Exception:print("SECURITY_UI_V11_ROLLBACK_ERROR",file.name,flush=True)
  print("SECURITY_UI_V11_ROLLED_BACK",flush=True)
  raise
if __name__=='__main__':main()
