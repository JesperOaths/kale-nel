#!/usr/bin/env python3
"""Install independent Security Camera Controls and anonymous face-folder views.

All three HTML assets are fetched from the same immutable commit and verified
by explicit SHA-256. Original Home Assistant Security root is backed up. Only
UI assets change; original recordings, Camera2 app, detection and archive
databases remain untouched. Roll back every changed file on any failed check.
"""
import argparse,datetime as dt,hashlib,json,os,re,stat,tempfile,urllib.request
from pathlib import Path
ROOT=Path("/opt/homeassistant/config/www")
APP=ROOT/"c720p-surveillance.html"
FACE=ROOT/"frontyard-security-new/security-face-folders-v22.html"
CONTROLS=ROOT/"frontyard-security-new/security-camera-controls-v22.html"
BACK=Path("/home/jespern/c720p-home-hub/backups/security-face-folders-v22")
REPO="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
SRC="ops/c720p/s9-native-security/"
FACES_URL="/local/frontyard-security-new/security-face-folders-v22.html?v=S9_FACE_FOLDERS_V22_20261012"
CONTROLS_URL="/local/frontyard-security-new/security-camera-controls-v22.html?v=S9_SETTINGS_V22_20261012"
STYLE='''<style id="security-independent-camera-panel-v22">
#s9v5-shell .s9v5-stage>section#panel-controls.s9v5-active{display:block!important;visibility:visible!important;opacity:1!important}
#s9v5-shell #panel-controls{padding:0!important;background:#0e1721!important;overflow:hidden!important}
#s9v5-shell #panel-controls>.controls{display:none!important}
#s9v5-shell #panel-controls #s9v22-camera-frame{display:block!important;width:100%!important;height:100%!important;min-height:0!important;border:0!important;background:#0e1721}
</style>'''
SCRIPT='''<script id="security-settings-panel-safety-v22">
(()=>{'use strict';
function ensure(){
 const nav=document.querySelector('#s9v5-nav button[data-view="camera"]');
 if(!nav||nav.getAttribute('aria-current')!=='page')return;
 const panel=document.getElementById('panel-controls');
 const frame=document.getElementById('s9v22-camera-frame');
 if(!panel||!frame)return;
 if(panel.hidden)panel.hidden=false;
 if(!panel.classList.contains('s9v5-active'))panel.classList.add('s9v5-active');
 if(!frame.src || frame.getAttribute('src')===null)frame.src=frame.dataset.src;
}
document.addEventListener('click',e=>{if(e.target.closest('#s9v5-nav button[data-view="camera"]'))setTimeout(ensure,90)},true);
window.addEventListener('pageshow',ensure);
setInterval(ensure,1300);
ensure();
})();
</script>'''
FRAME='<iframe id="s9v22-camera-frame" title="Native S9+ camera settings" data-src="'+CONTROLS_URL+'" loading="lazy"></iframe>'
def digest(blob):return hashlib.sha256(blob).hexdigest()
def http(url,limit):
 with urllib.request.urlopen(url,timeout=25) as response:
  if response.status!=200:raise RuntimeError("http_unavailable")
  data=response.read(limit+1)
 if len(data)>limit:raise RuntimeError("html_oversize")
 return data
def get(url):
 return json.loads(http(url,3500000))
def write(path,blob,owner):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix=".security-v22-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as out:out.write(blob);out.flush();os.fsync(out.fileno())
  mode=stat.S_IMODE(owner.st_mode) if owner else 0o644
  os.chmod(tmp,mode)
  if owner:
   try:os.chown(tmp,owner.st_uid,owner.st_gid)
   except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def patch_root(s):
 marker='security-settings-panel-safety-v22'
 if marker in s:
  if FACES_URL not in s or CONTROLS_URL not in s:raise RuntimeError("partial_previous_v22")
  return s
 path=r'/local/frontyard-security-new/face-appearances[.]html[?]v=[A-Za-z0-9_.-]+'
 s,n=re.subn(path,FACES_URL,s)
 if n!=1:raise RuntimeError("old_faces_iframe_source_contract")
 anchor='<section class="panel" id="panel-controls">'
 if s.count(anchor)!=1:raise RuntimeError("controls_panel_anchor_mismatch")
 s=s.replace(anchor,anchor+FRAME,1)
 if s.count('</head>')!=1 or s.count('</body>')!=1:
  raise RuntimeError("invalid_security_document")
 s=s.replace('</head>',STYLE+'\n</head>',1).replace('</body>',SCRIPT+'\n</body>',1)
 return s
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 for x in ("face-sha","settings-sha"):
  p.add_argument("--"+x,required=True)
 a=p.parse_args()
 if not re.fullmatch(r'[0-9a-f]{40}',a.ref):raise RuntimeError("invalid_commit")
 for val in (a.face_sha,a.settings_sha):
  if not re.fullmatch(r'[0-9a-f]{64}',val):raise RuntimeError("invalid_sha256")
 if not APP.is_file() or APP.is_symlink() or FACE.is_symlink() or CONTROLS.is_symlink():
  raise RuntimeError("unexpected_asset_path")
 assets={
  FACE:(http(REPO+a.ref+"/"+SRC+"security-face-folders-v22.html",400000),a.face_sha,"security-face-folders-v22"),
  CONTROLS:(http(REPO+a.ref+"/"+SRC+"security-camera-controls-v22.html",140000),a.settings_sha,"security-standalone-native-controls-v22")}
 for path,(data,sha,marker) in assets.items():
  if digest(data)!=sha or marker.encode() not in data:raise RuntimeError("html_source_contract_"+path.name)
 old_root=APP.read_bytes();new_root=patch_root(old_root.decode()).encode()
 pre=get("http://127.0.0.1:8794/new/api/saved")
 if pre.get("archive_mode")!="S9-microSD-only" or len(pre.get("events",[]))<260:
  raise RuntimeError("S9_catalog_health_failed")
 camera=get("http://127.0.0.1:8794/new/camera-controls")
 if camera.get("ok") is not True or "zoom" not in camera.get("controls",{}):
  raise RuntimeError("native_controls_unavailable")
 review=get("http://127.0.0.1:8794/new/api/drive-person-review")
 if len(review.get("clips",[]))<170:raise RuntimeError("historical_review_catalog_unavailable")
 originals={path:(path.read_bytes() if path.exists() else None,path.stat() if path.exists() else None) for path in [APP,FACE,CONTROLS]}
 changed=[path for path,new in [(APP,new_root),(FACE,assets[FACE][0]),(CONTROLS,assets[CONTROLS][0])] if originals[path][0]!=new]
 if not changed:
  print("SECURITY_FACE_FOLDERS_V22_VERIFIED "+json.dumps({"already":True,"drive_classified":len(review["clips"]),"s9_clips":len(pre["events"])}),flush=True);return
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 backup=BACK/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(mode=0o700)
 for i,path in enumerate(changed):
  old,st=originals[path]
  if old is not None:
   b=backup/(str(i)+"-"+path.name);b.write_bytes(old);os.chmod(b,0o600)
   if b.read_bytes()!=old:raise RuntimeError("backup_failed")
  if (path.read_bytes() if path.exists() else None)!=old:raise RuntimeError("concurrent_edit")
 completed=[]
 try:
  for path,new in [(FACE,assets[FACE][0]),(CONTROLS,assets[CONTROLS][0]),(APP,new_root)]:
   if path in changed:write(path,new,originals[path][1]);completed.append(path)
  for path,url,new in ((FACE,FACES_URL,assets[FACE][0]),(CONTROLS,CONTROLS_URL,assets[CONTROLS][0]),
                       (APP,"/local/c720p-surveillance.html?v=security-face-v22",new_root)):
   if digest(http("http://127.0.0.1:8123"+url,3500000))!=digest(new):
    raise RuntimeError("served_html_mismatch_"+path.name)
  after=get("http://127.0.0.1:8794/new/api/saved")
  if len(after.get("events",[]))<len(pre["events"]):raise RuntimeError("archive_regressed")
  print("SECURITY_FACE_FOLDERS_V22_VERIFIED "+json.dumps({
   "already":False,"backup":str(backup),"assets_installed":len(completed),
   "classified_drive_clips":len(review["clips"]),"microSD_clips":len(after["events"]),
   "camera_controls":list(camera["controls"]),"face_gallery_http_verified":True,
   "camera_unchanged":True,"recordings_unchanged":True}),flush=True)
 except BaseException:
  for path in reversed(completed):
   old,st=originals[path]
   try:
    if old is None:path.unlink(missing_ok=True)
    else:write(path,old,st)
   except Exception:print("SECURITY_FACE_V22_MANUAL_RESTORE_NEEDED",path.name,flush=True)
  print("SECURITY_FACE_FOLDERS_V22_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
