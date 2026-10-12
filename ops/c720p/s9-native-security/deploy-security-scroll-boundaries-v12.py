#!/usr/bin/env python3
"""Fix nested Security scroll boundaries on C720P Home Assistant (v12).

Preserves all current HTML/app logic. Replaces only a uniquely identified style
block on the Security shell and each embedded document; backs up every file,
validates CSS wrappers, HTTP readbacks, and both archive catalogs. Restores on
failure. Does not touch camera app, stored clips, detection, or services.
"""
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import tempfile
import urllib.request

WWW=Path("/opt/homeassistant/config/www")
SUB=WWW/"frontyard-security-new"
BACK=Path("/home/jespern/c720p-home-hub/backups/security-scroll-boundaries-v12")
MARK="s9-security-scroll-boundaries-v12"
VERSION="C720P_SECURITY_SCROLL_BOUNDARIES_V12_20261012"

RULES={
 "c720p-surveillance.html":"""
/* The root Security stage must never become a second vertical scroller. */
html,body{height:100%!important;max-height:100%!important;overflow:hidden!important}
#s9v5-shell{height:100%!important;max-height:100%!important;min-height:0!important;overflow:hidden!important}
#s9v5-shell .s9v5-main{min-height:0!important;max-height:100%!important;overflow:hidden!important}
#s9v5-shell .s9v5-stage{min-height:0!important;max-height:100%!important;overflow:hidden!important}
#s9v5-shell #panel-saved,#s9v5-shell #panel-faces{overflow:hidden!important;min-height:0!important}
#s9v5-shell #panel-saved iframe,#s9v5-shell #panel-faces iframe,
#s9v7-tracks-pane iframe,#s9v8-evidence iframe{
 width:100%!important;height:100%!important;min-height:0!important;
 max-height:100%!important;display:block;border:0!important
}
#s9v7-tracks-pane,#s9v8-evidence{max-height:100%!important;overflow:hidden!important;min-height:0!important}
#s9v5-shell #panel-live.s9v5-active,#s9v5-shell #panel-controls.s9v5-active,
#s9v5-shell #panel-camera.s9v5-active{
 overflow-y:auto!important;overflow-x:hidden!important;
 min-height:0!important;overscroll-behavior-y:contain!important;
 scrollbar-gutter:stable;scroll-padding-bottom:44px!important
}
#s9v5-shell #panel-live .c720p-s9-live-only{padding-bottom:54px!important}
#s9v5-shell #panel-controls>.controls{padding-bottom:40px!important}
/* On current HA builds the legacy control panel is under #view, not #s9v5-shell.
   The extra embedded control iframe occupied an entire viewport above the actual
   controls, making the bottom of the settings panel unreachable. */
#panel-controls{
 overflow-y:auto!important;overflow-x:hidden!important;min-height:0!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable!important;
 scroll-padding-bottom:55px!important
}
#panel-controls #s9v22-camera-frame{display:none!important}
#panel-controls>.controls{
 box-sizing:border-box!important;display:block!important;height:auto!important;
 min-height:0!important;overflow:visible!important;padding-bottom:55px!important
}
/* Override legacy #view > .panel overflow rules with full selector specificity. */
html body #view > section#panel-controls.panel.active.s9v5-active,
html body .view > section#panel-controls.panel.active.s9v5-active,
body section#panel-controls.panel.active.s9v5-active{
 overflow-y:auto!important;overflow-x:hidden!important;
 max-height:calc(100% - 69px)!important;min-height:0!important;
 scrollbar-gutter:stable!important;overscroll-behavior-y:contain!important
}
html body #view > section#panel-controls.panel.active.s9v5-active > iframe#s9v22-camera-frame,
html body .view > section#panel-controls.panel.active.s9v5-active > iframe#s9v22-camera-frame,
body section#panel-controls.panel.active.s9v5-active > iframe#s9v22-camera-frame{
 display:none!important;height:0!important
}
html body #view > section#panel-controls.panel.active.s9v5-active > .controls,
html body .view > section#panel-controls.panel.active.s9v5-active > .controls,
body section#panel-controls.panel.active.s9v5-active > .controls{
 display:block!important;height:auto!important;min-height:0!important;
 overflow:visible!important;padding-bottom:60px!important
}
""",
 "frontyard-security-new/security-archive-v7.html":"""
/* The iframe's actual client height, not its outer Home Assistant viewport. */
html,body{height:100%!important;min-height:0!important;overflow:hidden!important}
main#archive{
 box-sizing:border-box!important;height:100%!important;min-height:0!important;
 max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable!important;
 scroll-padding-bottom:52px!important;padding-bottom:max(64px,env(safe-area-inset-bottom))!important
}
#driveTimeline,#timeline{min-width:0;max-width:100%}
""",
 "frontyard-security-new/security-review-v8.html":"""
html,body{height:100%!important;min-height:0!important;overflow:hidden!important}
main{
 box-sizing:border-box!important;height:100%!important;min-height:0!important;
 max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable!important;
 scroll-padding-bottom:60px!important;padding-bottom:max(64px,env(safe-area-inset-bottom))!important
}
""",
 "frontyard-security-new/security-tracks-v7.html":"""
html,body{height:100%!important;min-height:0!important;overflow:hidden!important}
#app{box-sizing:border-box!important;height:100%!important;max-height:100%!important;min-height:0!important;overflow:hidden!important}
.workspace,.content{min-height:0!important;max-height:100%!important}
.results,aside{
 min-height:0!important;overscroll-behavior-y:contain!important;
 scrollbar-gutter:stable;scroll-padding-bottom:56px!important
}
.results{padding-bottom:max(58px,env(safe-area-inset-bottom))!important}
aside{padding-bottom:max(36px,env(safe-area-inset-bottom))!important}
""",
 "frontyard-security-new/security-face-folders-v22.html":"""
html{height:100%!important;min-height:0!important;overflow:hidden!important}
body{
 box-sizing:border-box!important;height:100%!important;max-height:100%!important;
 min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable;
 scroll-padding-bottom:52px!important;padding-bottom:max(54px,env(safe-area-inset-bottom))!important
}
#legacyView{display:block;max-width:100%;height:min(62dvh,650px)!important;
 min-height:min(320px,45dvh)!important}
""",
 "frontyard-security-new/face-appearances.html":"""
html{height:100%!important;min-height:0!important;overflow:hidden!important}
body{
 box-sizing:border-box!important;height:100%!important;max-height:100%!important;
 min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable;
 scroll-padding-bottom:54px!important;padding-bottom:max(54px,env(safe-area-inset-bottom))!important
}
dialog{max-height:calc(100dvh - 30px)!important;overflow-y:auto!important;overscroll-behavior-y:contain!important}
""",
 "frontyard-security-new/clips.html":"""
/* Recordings: only the clip list (and player when necessary) should scroll. */
html,body{height:100%!important;min-height:0!important;overflow:hidden!important}
#s9v5-browser{height:100%!important;max-height:100%!important;min-height:0!important;overflow:hidden!important}
#s9v5-browser #s9-compact-layout{flex:1 1 auto!important;min-height:0!important;max-height:100%!important}
#s9v5-browser .s9-selector-pane{min-height:0!important;overflow:hidden!important}
#s9v5-browser #list{
 min-height:0!important;max-height:100%!important;overflow-y:auto!important;
 overscroll-behavior-y:contain!important;scrollbar-gutter:stable!important;
 scroll-padding-bottom:64px!important;padding-bottom:66px!important
}
#s9v5-browser .s9-playback-pane{
 overscroll-behavior-y:contain!important;
 scroll-padding-bottom:36px!important
}
@media(max-width:600px){
 #s9v5-browser #s9-compact-layout{
  grid-template-rows:minmax(135px,31dvh) minmax(0,1fr)!important;
  min-height:0!important;overflow:hidden!important
 }
}
""",
 "frontyard-security-new/gpu-performance-player-v1.html":"""
html{height:100%!important;min-height:0!important;overflow:hidden!important}
body{
 box-sizing:border-box!important;height:100%!important;max-height:100%!important;
 min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;
 overscroll-behavior-y:contain!important;scroll-padding-bottom:40px!important;
 padding-bottom:42px!important
}
""",
}
def sha(d):return hashlib.sha256(d).hexdigest()
def catalog(route):
 with urllib.request.urlopen("http://127.0.0.1:8795"+route,timeout=22) as r:
  doc=json.load(r)
 if doc.get("ok") is not True or not isinstance(doc.get("events"),list):
  raise RuntimeError("archive_index_invalid:"+route)
 return len(doc["events"])
def atomic(p,data,meta):
 fd,tmp=tempfile.mkstemp(prefix=".security-scroll-v12-",suffix=".html",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(meta.st_mode))
  try:os.chown(tmp,meta.st_uid,meta.st_gid)
  except PermissionError:pass
  os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 before=(catalog("/new/api/saved"),catalog("/new/api/drive-saved"))
 originals={};updated={};modes={}
 for rel,css in RULES.items():
  p=WWW/rel
  if not p.is_file() or p.is_symlink():raise RuntimeError("missing_or_linked_html:"+rel)
  data=p.read_bytes();text=data.decode("utf-8")
  if text.count("</head>")!=1 or text.count("</body>")!=1:
   raise RuntimeError("page_structure_changed:"+rel)
  if len(text)<3500 or len(text)>250000:raise RuntimeError("unexpected_page_size:"+rel)
  first="<style id=\""+MARK+"\">"
  newblock=first+"\n"+css.strip()+"\n</style>"
  if first in text:
   start=text.index(first);end=text.find("</style>",start)
   if end<0 or end-start>18000:raise RuntimeError("scroll_patch_corrupt:"+rel)
   modified=text[:start]+newblock+text[end+len("</style>"):]
  else:
   modified=text.replace("</head>",newblock+"\n</head>",1)
  # The HA kiosk retained old iframe HTML under unchanged embedded URLs.
  # Change only allowlisted frontend page references, never media/API URLs.
  if rel=="c720p-surveillance.html":
   allowed=re.compile(r'((?:security-archive-v7|security-review-v8|security-tracks-v7|security-face-folders-v22|clips)[.]html[?][A-Za-z0-9_&=%.-]{1,230})')
   found=allowed.findall(modified)
   if len(found)<4:raise RuntimeError("embedded_security_routes_missing")
   modified=allowed.sub(lambda m:m.group(1) if "scrollBoundary=v12" in m.group(1)
                        else m.group(1)+"&scrollBoundary=v12",modified)
  if modified.count(first)!=1:raise RuntimeError("duplicate_style:"+rel)
  if rel=="c720p-surveillance.html" and ("#s9v5-shell" not in modified or "s9v5-stage" not in modified):
   raise RuntimeError("security_shell_contract_changed")
  originals[p]=data;updated[p]=modified.encode();modes[p]=p.stat()
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 folder=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(mode=0o700)
 for p,data in originals.items():
  backup=folder/p.relative_to(WWW);backup.parent.mkdir(parents=True,exist_ok=True)
  backup.write_bytes(data);os.chmod(backup,0o600)
  if sha(backup.read_bytes())!=sha(data):raise RuntimeError("backup_readback_failed")
 changed=[]
 try:
  for p,data in updated.items():
   if p.read_bytes()!=originals[p]:raise RuntimeError("concurrent_html_change:"+p.name)
   atomic(p,data,modes[p]);changed.append(p)
  verified=[]
  for p,data in updated.items():
   url="http://127.0.0.1:8123/local/"+p.relative_to(WWW).as_posix()+"?v="+VERSION
   with urllib.request.urlopen(url,timeout=25) as r:served=r.read(300000)
   if sha(served)!=sha(data):raise RuntimeError("HA_http_readback_failed:"+p.name)
   verified.append(p.name)
  after=(catalog("/new/api/saved"),catalog("/new/api/drive-saved"))
  if after[0]<before[0] or after[1]<before[1]:
   raise RuntimeError("catalog_regression")
  print("SECURITY_SCROLL_BOUNDARIES_V12_DEPLOYED",json.dumps({
   "pages":verified,"backup":str(folder),"sd_clips":after[0],
   "drive_clips":after[1],"security_camera_unchanged":True,
   "recordings_untouched":True,"http_verified":True,"version":VERSION},sort_keys=True),flush=True)
 except BaseException:
  for p in reversed(changed):
   try:atomic(p,originals[p],modes[p])
   except Exception as e:print("ROLLBACK_ERROR",p.name,str(e)[:100],flush=True)
  print("SECURITY_SCROLL_BOUNDARIES_V12_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
