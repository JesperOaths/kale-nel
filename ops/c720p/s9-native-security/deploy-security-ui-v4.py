#!/usr/bin/env python3
"""C720P Security UI V4: atomic two-page HTML deployment with rollback.

No Camera2, APK, video, thumbnail, database or archive changes. Only:
  /opt/homeassistant/config/www/frontyard-security-new/clips.html
  /opt/homeassistant/config/www/c720p-surveillance.html
Never substitutes a new page for an unrecognized installed layout.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

DEFAULT_ROOT=Path('/opt/homeassistant/config/www')
DEFAULT_BACKUPS=Path('/home/jespern/c720p-home-hub/backups/security-ui-v4')
PATCHES={
 'folders':'patch-security-date-category-folders.py',
 'rotation':'patch-s9-saved-video-orientation.py',
 'compact':'patch-security-compact-layout.py',
 'badges':'patch-detector-version-badges.py',
}
REQUIRED_ORIGINAL_SAVED=(
 'id="player"','id="list"','c720p-secure-relay-client.js',
 's9-video-orientation-script-v1',
)
REQUIRED_ORIGINAL_LIVE=('id="panel-live"','id="cameraLive"','c720p-s9-live-only')
REQUIRED_INSTALLED_SAVED=(
 's9-v4-date-dots','s9-v4-legend','s9-v4-clip',
 's9-compact-layout','s9-rotation-shell','s9-detector-version-badges',
)
REQUIRED_INSTALLED_LIVE=('s9-live-viewport-fit-v1','70dvh','id="cameraLive"')


def sha(content):
 return hashlib.sha256(content.encode('utf-8')).hexdigest()

def module(path, ident):
 spec=importlib.util.spec_from_file_location(ident,path)
 if spec is None or spec.loader is None:raise RuntimeError('cannot_import_patch_'+ident)
 obj=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(obj)
 return obj

def verify_source(path, required, kind):
 if not path.is_file() or path.is_symlink():raise RuntimeError('bad_'+kind+'_target')
 data=path.read_text(encoding='utf-8')
 for item in required:
  if item not in data:raise RuntimeError('missing_'+kind+'_anchor_'+item)
 if data.count('</head>')!=1 or data.count('</body>')!=1:
  raise RuntimeError('unexpected_'+kind+'_document_structure')
 return data

def plan(staging, root):
 saved=root/'frontyard-security-new/clips.html'
 live=root/'c720p-surveillance.html'
 old_saved=verify_source(saved,REQUIRED_ORIGINAL_SAVED,'saved')
 old_live=verify_source(live,REQUIRED_ORIGINAL_LIVE,'live')
 funcs={name:module(staging/file,'s9_ui_v4_'+name)
        for name,file in PATCHES.items()}
 # Upgrade older existing injected scripts rather than accumulating widgets.
 # The badge patch is applied AFTER the v4 date widget exists.
 new_saved=funcs['folders'].patch(old_saved)
 new_saved=funcs['rotation'].patch(new_saved)
 new_saved=funcs['badges'].patch(new_saved)
 new_saved=funcs['compact'].patch(new_saved,'saved')
 new_live=funcs['compact'].patch(old_live,'live')
 for item in REQUIRED_INSTALLED_SAVED:
  if item not in new_saved:raise RuntimeError('saved_result_missing_'+item)
 for item in REQUIRED_INSTALLED_LIVE:
  if item not in new_live:raise RuntimeError('live_result_missing_'+item)
 # Both transformations must be stable before writing any bytes.
 if funcs['compact'].patch(funcs['badges'].patch(
    funcs['rotation'].patch(funcs['folders'].patch(new_saved))),'saved')!=new_saved:
  raise RuntimeError('saved_patch_not_idempotent')
 if funcs['compact'].patch(new_live,'live')!=new_live:
  raise RuntimeError('live_patch_not_idempotent')
 for token in ('C720PSecureRelay','/new/saved/clip/'):
  if token not in new_saved:raise RuntimeError('authenticated_media_contract_broken_'+token)
 if '<video id="player"' not in new_saved and 'id="player"' not in new_saved:
  raise RuntimeError('original_video_player_missing')
 return {saved:(old_saved,new_saved),live:(old_live,new_live)}

def install(updates,backup_root):
 changed={str(path):(old!=new) for path,(old,new) in updates.items()}
 if not any(changed.values()):return {'changed':changed,'already_installed':True}
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup=backup_root/stamp
 backup.mkdir(parents=True,exist_ok=False)
 os.chmod(backup,0o700)
 originals={}
 for idx,(path,(old,new)) in enumerate(updates.items()):
  dest=backup/(str(idx)+'-'+path.name)
  shutil.copy2(path,dest)
  os.chmod(dest,0o600)
  if dest.read_text(encoding='utf-8')!=old:raise RuntimeError('backup_mismatch')
  originals[path]=dest
 completed=[]
 try:
  for path,(old,new) in updates.items():
   if old==new:continue
   fd,tmp=tempfile.mkstemp(prefix='.s9-ui-v4-',suffix='.html',dir=path.parent)
   os.close(fd)
   temp=Path(tmp)
   try:
    temp.write_text(new,encoding='utf-8')
    st=path.stat()
    os.chmod(temp,st.st_mode & 0o777)
    try:os.chown(temp,st.st_uid,st.st_gid)
    except PermissionError:pass
    if temp.read_text(encoding='utf-8')!=new:raise RuntimeError('staged_integrity_failure')
    os.replace(temp,path)
   finally:temp.unlink(missing_ok=True)
   completed.append(path)
  for path,(old,new) in updates.items():
   if path.read_text(encoding='utf-8')!=new:
    raise RuntimeError('postwrite_mismatch_'+path.name)
 except Exception:
  for path in reversed(completed):
   rollback=path.with_name('.s9-ui-v4-rollback-'+path.name)
   shutil.copy2(originals[path],rollback)
   os.replace(rollback,path)
  raise
 return {'changed':changed,'backup':str(backup),'sha256':{
         str(p):sha(text[1]) for p,text in updates.items()},
         'recordings_modified':False,'camera_app_modified':False}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--staging',type=Path,default=Path(__file__).resolve().parent)
 ap.add_argument('--root',type=Path,default=DEFAULT_ROOT)
 ap.add_argument('--backup-root',type=Path,default=DEFAULT_BACKUPS)
 ap.add_argument('--apply',action='store_true')
 args=ap.parse_args()
 updates=plan(args.staging.resolve(),args.root.resolve())
 if not args.apply:
  print('SECURITY_UI_V4_DRY_RUN_OK',json.dumps({
   'targets':{str(path):{'changes':old!=new,'current_sha256':sha(old),'next_sha256':sha(new)}
              for path,(old,new) in updates.items()},
   'recordings_modified':False,'camera_app_modified':False
  },sort_keys=True))
  return
 report=install(updates,args.backup_root)
 print('SECURITY_UI_V4_INSTALLED',json.dumps(report,sort_keys=True))
if __name__=='__main__':
 main()
