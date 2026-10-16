#!/usr/bin/env python3
"""Security V7: separate Tracks tab, spacious SD Archive, scroll-safe Recordings.

Presentation files only. Transactional HTML publication; no media, APK, relay, or recorder changes.
"""
import argparse,hashlib,json,os,re,shutil,tempfile
from pathlib import Path
from datetime import datetime,timezone

ROOT=Path("/opt/homeassistant/config/www")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/security-v7")
REL={
 "security":"c720p-surveillance.html",
 "recordings":"frontyard-security-new/clips.html",
 "archive":"frontyard-security-new/security-archive-v7.html",
 "tracks":"frontyard-security-new/security-tracks-v7.html",
}

ROOT_CSS=r"""
<style id="s9v7-root-style">
#s9v7-tracks-pane{position:absolute;inset:0;z-index:4;display:none;background:#0e151e;min-height:0;min-width:0}
#s9v7-tracks-pane.s9v7-active{display:block!important}
#s9v7-tracks-pane iframe{width:100%;height:100%;border:0;display:block;background:#0e151e}
#s9v5-shell[data-view="tracks"] #panel-saved{visibility:hidden!important;pointer-events:none!important}
#s9v5-nav button[data-view="tracks"]{font:inherit}
#s9v5-nav button[data-view="tracks"][aria-current="page"]{background:#223d43!important;border-color:#31595e!important;color:#eafff8!important}
@media(max-width:600px){
#s9v5-nav button[data-view="tracks"]{padding:5px 2px!important}
#s9v5-nav button[data-view="tracks"] .s9v5-nav-label{white-space:nowrap;font-size:9px!important}
}
</style>"""

ROOT_JS=r"""
<script id="s9v7-root-script">
(()=>{
'use strict';
const qs=q=>document.querySelector(q);
const TRACKS='/local/frontyard-security-new/security-tracks-v7.html';
const ARCHIVE='/local/frontyard-security-new/security-archive-v7.html';
function mount(){
 const shell=qs('#s9v5-shell'),nav=qs('#s9v5-nav'),stage=qs('#s9v5-stage'),drive=qs('#cameraSavedFrame');
 if(!shell||!nav||!stage||!drive)return false;
 // Replace only the archive iframe destination, preserving the legacy Drive page.
 if(drive.dataset.src!==ARCHIVE){
  drive.dataset.src=ARCHIVE;
  if(drive.getAttribute('src')!==ARCHIVE)drive.removeAttribute('src');
 }
 let button=nav.querySelector('button[data-view="tracks"]');
 if(!button){
  button=document.createElement('button');button.type='button';button.dataset.view='tracks';
  button.title='Tracks & clothing';button.setAttribute('aria-current','false');
  const ico=document.createElement('span');ico.className='s9v5-nav-icon';ico.textContent='◇';
  const label=document.createElement('span');label.className='s9v5-nav-label';label.textContent='Tracks & clothing';
  button.append(ico,label);
  const archive=nav.querySelector('button[data-view="archive"]');nav.insertBefore(button,archive||null);
 }
 let section=qs('#s9v7-tracks-pane');
 if(!section){
  section=document.createElement('section');section.id='s9v7-tracks-pane';
  const iframe=document.createElement('iframe');iframe.title='S9+ anonymous tracks and clothing filters';
  iframe.id='s9v7-tracks-frame';iframe.loading='lazy';iframe.dataset.src=TRACKS;
  section.append(iframe);stage.append(section);
 }
 const hide=()=>{
  section.classList.remove('s9v7-active');
  section.setAttribute('aria-hidden','true');
  button.setAttribute('aria-current','false');
  const iframe=section.querySelector('iframe');
  try{iframe.contentWindow?.document.querySelectorAll('video').forEach(v=>v.pause())}catch(_){}
 };
 nav.addEventListener('click',e=>{const el=e.target.closest('button[data-view]');if(el&&el!==button)hide()});
 button.addEventListener('click',()=>{
  // Preserve all original saved-tab stream/media lifecycles through its handler.
  const saved=nav.querySelector('button[data-view="saved"]');
  if(saved)saved.click();
  shell.dataset.view='tracks';
  for(const b of nav.querySelectorAll('button[data-view]'))b.setAttribute('aria-current',b===button?'page':'false');
  const title=qs('#s9v5-title');if(title)title.textContent='Tracks & clothing';
  const sub=qs('#s9v5-subtitle');if(sub)sub.textContent='';
  section.classList.add('s9v7-active');section.setAttribute('aria-hidden','false');
  const frame=section.querySelector('iframe');
  if(!frame.getAttribute('src'))frame.src=frame.dataset.src;
 });
 section.setAttribute('aria-hidden',section.classList.contains('s9v7-active')?'false':'true');
 return true;
}
if(!mount()){
 let count=0;const timer=setInterval(()=>{if(mount()||++count>=80)clearInterval(timer)},125);
}
})();
</script>"""

RECORDINGS_CSS=r"""
<style id="s9v7-recordings-scroll-style">
/* One vertical scroll owner: the recording list (not the iframe or entire page). */
html:has(#s9v5-browser),body:has(#s9v5-browser){height:100%!important;overflow:hidden!important}
#s9v5-browser{height:100dvh!important;min-height:0!important;overflow:hidden!important}
#s9v5-browser #s9-compact-layout{flex:1 1 auto!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;align-items:stretch!important}
#s9v5-browser #s9-compact-layout .s9-selector-pane{
  display:flex!important;flex-direction:column!important;min-height:0!important;
  max-height:100%!important;overflow:hidden!important;contain:layout!important
}
#s9v5-browser #s9-compact-layout .s9-selector-pane #list{
  flex:1 1 0%!important;min-height:0!important;height:0!important;
  max-height:none!important;overflow-y:scroll!important;overflow-x:hidden!important;
  overscroll-behavior-y:contain!important;scrollbar-gutter:stable!important;
  padding-right:12px!important;scroll-behavior:auto
}
#s9v5-browser #s9-date-folders{min-height:0!important;width:100%!important;overflow:visible!important}
#s9v5-browser .s9-v4-cards{min-height:0!important;overflow:visible!important}
#s9v5-browser #s9-anonymous-clips-v1{display:none!important}
#s9v5-browser #list::-webkit-scrollbar{width:12px}
#s9v5-browser #list::-webkit-scrollbar-track{background:#0f1c27;border-radius:8px}
#s9v5-browser #list::-webkit-scrollbar-thumb{background:#4b6d7d;border:2px solid #0f1c27;border-radius:9px}
#s9v5-browser #list{scrollbar-color:#4b6d7d #0f1c27!important;scrollbar-width:auto!important}
@media(max-width:760px){
 #s9v5-browser #s9-compact-layout{
  grid-template-rows:minmax(130px,165px) minmax(0,1fr)!important;
  overflow:hidden!important;height:100%!important
 }
 #s9v5-browser #s9-compact-layout .s9-selector-pane{min-height:0!important;max-height:none!important}
 #s9v5-browser #s9-compact-layout .s9-selector-pane #list{height:0!important;min-height:0!important}
}
</style>"""

MARKERS=("s9-anonymous-clips-style-v1","s9-anonymous-clips-script-v1")
def insert(html,tag,id_,snippet,closing):
 marker=f'<{tag} id="{id_}">'
 if html.count(marker)>1:raise RuntimeError("duplicate_"+id_)
 if marker in html:
  expr=re.escape(marker)+r"(?s:.*?)</"+tag+r">"
  html,n=re.subn(expr,lambda match:snippet.strip(),html,count=1)
  if n!=1:raise RuntimeError("invalid_"+id_)
 else:html=html.replace(closing,snippet.strip()+"\n"+closing,1)
 return html

def patch_root(html):
 for tag in ['s9v5-command-script','s9v6-security-script','s9v6-security-style']:
  if f'id="{tag}"' not in html:raise ValueError("missing_security_"+tag)
 if 'id="cameraSavedFrame"' not in html or 'id="s9SavedFolderFrame"' not in html:raise ValueError("unsafe_root")
 html=insert(html,'style','s9v7-root-style',ROOT_CSS,'</head>')
 return insert(html,'script','s9v7-root-script',ROOT_JS,'</body>')

def patch_recordings(html):
 for marker in ['s9v5-browser-script','s9v6-recordings-style','s9-saved-virtual-folders-script-v1','id="list"']:
  if marker not in html:raise ValueError("missing_recordings_"+marker)
 for marker in MARKERS:
  if html.count('id="'+marker+'"')>1:raise RuntimeError("duplicate_anon_marker")
 if ('id="'+MARKERS[0]+'"') in html and ('id="'+MARKERS[1]+'"') in html:
  # The exact old widget is moved, not duplicated. Keep all signed media and list handlers.
  for tag,mark in [('style',MARKERS[0]),('script',MARKERS[1])]:
   expression=r'\s*<'+tag+' id="'+mark+r'">(?s:.*?)</'+tag+'>'
   html,n=re.subn(expression,'',html,count=1)
   if n!=1:raise RuntimeError("unexpected_old_anonymous_widget")
 elif any('id="'+mark+'"' in html for mark in MARKERS):
  raise RuntimeError("partial_anonymous_widget")
 return insert(html,'style','s9v7-recordings-scroll-style',RECORDINGS_CSS,'</head>')

def validate_template(html,kind):
 if len(html)<5000 or html.count('</head>')!=1 or html.count('</body>')!=1:raise ValueError("invalid_"+kind+"_template")
 if (not any(m in html for m in (['id="s9v7-tracks-script"','id="s9v25-tracks-script"'] if kind=="tracks" else [f'id="s9v7-{kind}-script"'])) or 'C720PSecureRelay' not in html or '/new/api/saved' not in html):raise ValueError("unsigned_"+kind)
 if '/new/saved/clip/' not in html:raise ValueError("missing_video_contract")

def build(root,source):
 updates={}
 for kind in ('archive','tracks'):
  target=root/REL[kind];src=source/("security-"+kind+"-v7.html")
  if not src.is_file():raise ValueError("missing_template_"+kind)
  new=src.read_text(encoding='utf-8');validate_template(new,kind)
  if target.is_symlink():raise ValueError("unsafe_"+kind)
  old=target.read_text(encoding='utf-8') if target.exists() else None
  updates[target]=(old,new)
 for kind,patcher in [('security',patch_root),('recordings',patch_recordings)]:
  target=root/REL[kind]
  if target.is_symlink() or not target.is_file():raise ValueError("missing_"+kind)
  old=target.read_text(encoding='utf-8')
  if not(800<len(old)<2_000_000):raise ValueError("invalid_size_"+kind)
  new=patcher(old)
  if patcher(new)!=new:raise ValueError("non_idempotent_"+kind)
  updates[target]=(old,new)
 return updates

def deploy(root,source,backup_root,apply=False):
 updates=build(root,source)
 if not apply:return {"dry_run":True,"changed":{str(p):old!=new for p,(old,new) in updates.items()}}
 if not any(old!=new for old,new in updates.values()):return {"already_installed":True}
 backup=backup_root/datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,exist_ok=False);os.chmod(backup,0o700)
 originals={};written=[]
 try:
  for i,(target,(old,new)) in enumerate(updates.items()):
   copy=backup/(str(i)+'-'+target.name)
   if old is not None:
    shutil.copy2(target,copy)
    if copy.read_text(encoding='utf-8')!=old:raise RuntimeError("backup_mismatch")
    os.chmod(copy,0o600)
    originals[target]=copy
   else:originals[target]=None
  for target,(old,new) in updates.items():
   if old==new:continue
   target.parent.mkdir(parents=True,exist_ok=True)
   fd,staging=tempfile.mkstemp(prefix=".security-v7-",suffix=".html",dir=target.parent);os.close(fd)
   temp=Path(staging)
   try:
    temp.write_text(new,encoding='utf-8')
    if old is not None:
     st=target.stat();os.chmod(temp,st.st_mode&0o777)
     try:os.chown(temp,st.st_uid,st.st_gid)
     except PermissionError:pass
    else:os.chmod(temp,0o644)
    if temp.read_text(encoding='utf-8')!=new:raise RuntimeError("stage_failed")
    os.replace(temp,target);written.append(target)
   finally:temp.unlink(missing_ok=True)
  for path,(_,new) in updates.items():
   if path.read_text(encoding='utf-8')!=new:raise RuntimeError("postwrite_mismatch")
 except BaseException:
  for target in reversed(written):
   original=originals[target]
   if original:
    candidate=target.with_name(".security-v7-restore-"+target.name)
    shutil.copy2(original,candidate);os.replace(candidate,target)
   else:target.unlink(missing_ok=True)
  raise
 return {"installed":True,"backup":str(backup),
   "sha256":{str(p):hashlib.sha256(new.encode()).hexdigest() for p,(_,new) in updates.items()},
   "camera_changed":False,"media_changed":False}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--root',type=Path,default=ROOT)
 ap.add_argument('--source',type=Path,default=Path(__file__).resolve().parent)
 ap.add_argument('--backup-root',type=Path,default=BACKUPS)
 ap.add_argument('--apply',action='store_true')
 a=ap.parse_args()
 print("SECURITY_V7",json.dumps(deploy(a.root,a.source,a.backup_root,a.apply),sort_keys=True),flush=True)

if __name__=="__main__":main()
