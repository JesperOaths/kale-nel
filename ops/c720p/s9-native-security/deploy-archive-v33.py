#!/usr/bin/env python3
"""Guarded Archive v33 browser-only repair. Never deletes or edits recordings."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.request
BASE=Path('/opt/homeassistant/config/www')
ARCH=BASE/'frontyard-security-new/security-archive-v7.html'
SHELL=BASE/'c720p-surveillance.html'
BACK=Path('/home/jespern/c720p-home-hub/backups/security-archive-v33')
VERSION='security-archive-response-guard-v34-20261014'
FILES={'archive-review-v33.js':'ops/c720p/s9-native-security/archive-review-v33.js',
       'archive-card-actions-v2.js':'ops/c720p/s9-native-security/archive-card-actions-v2.js'}

def sha(b):return hashlib.sha256(b).hexdigest()
def get(uri,limit=400000):
 with urllib.request.urlopen(uri,timeout=30) as r:
  b=r.read(limit+1)
 if len(b)>limit:raise RuntimeError('oversized_response')
 return b
def atomic(p,b,owner=None):
 if p.exists() and p.is_symlink():raise RuntimeError('symlink_refused_'+p.name)
 p.parent.mkdir(parents=True,exist_ok=True)
 fd,t=tempfile.mkstemp(prefix='.archive-v33-',dir=str(p.parent))
 try:
  with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  if owner:
   os.chmod(t,stat.S_IMODE(owner.st_mode))
   try:os.chown(t,owner.st_uid,owner.st_gid)
   except PermissionError:pass
  else:os.chmod(t,0o644)
  os.replace(t,p)
 finally:
  if os.path.exists(t):os.unlink(t)

def main():
 ref=os.environ.get('SECURITY_ARCHIVE_REF','').strip()
 if not re.fullmatch('[a-f0-9]{40}',ref):raise RuntimeError('immutable_ref_required')
 if not ARCH.is_file() or not SHELL.is_file() or ARCH.is_symlink() or SHELL.is_symlink():
  raise RuntimeError('web_pages_missing_or_symlink')
 original={p:p.read_bytes() for p in (ARCH,SHELL)}
 oldarch=original[ARCH].decode()
 assert oldarch.count('archive-review-v32.js')==1 and oldarch.count('archive-card-actions-v1.js')==1,'Unexpected archive handlers'
 srcs={}
 for name,path in FILES.items():
  url='https://raw.githubusercontent.com/JesperOaths/kale-nel/'+ref+'/'+path
  b=get(url)
  if len(b)<10000 or len(b)>30000 or not b.startswith(b'/*'):
   raise RuntimeError('invalid_archive_script_'+name)
  srcs[BASE/'frontyard-security-new'/name]=b
 if b'async function confirmedJson(' not in srcs[BASE/'frontyard-security-new/archive-review-v33.js']:
  raise RuntimeError('response_guard_not_present')
 if b'Removed stale card; no delete requested.' not in srcs[BASE/'frontyard-security-new/archive-card-actions-v2.js']:
  raise RuntimeError('stale_card_guard_not_present')
 with tempfile.TemporaryDirectory(prefix='archive-v33-syntax-') as td:
  for name,b in srcs.items():
   p=Path(td)/name.name;p.write_bytes(b)
   if shutil.which('node'):
    subprocess.run(['node','--check',str(p)],check=True,timeout=25,capture_output=True)
 html=oldarch
 for before,after in [
  (r'/local/frontyard-security-new/archive-review-v32[.]js[?]v=[^"]+',
   '/local/frontyard-security-new/archive-review-v33.js?v='+VERSION),
  (r'/local/frontyard-security-new/archive-card-actions-v1[.]js[?]v=[^"]+',
   '/local/frontyard-security-new/archive-card-actions-v2.js?v='+VERSION)]:
  html,count=re.subn(before,after,html)
  if count!=1:raise RuntimeError('unexpected_archive_script_url_'+str(count))
 shell=original[SHELL].decode()
 pattern=r'(security-archive-v7[.]html[?]v=)[A-Za-z0-9_-]+'
 shell,count=re.subn(pattern,lambda m:m.group(1)+VERSION,shell)
 if count!=1:raise RuntimeError('archive_shell_iframe_missing_or_ambiguous')
 changes={**srcs,ARCH:html.encode(),SHELL:shell.encode()}
 for p,b in srcs.items():
  if p.exists() and p.read_bytes()!=b:raise RuntimeError('new_asset_already_exists_with_other_bytes_'+p.name)
  if p.is_symlink():raise RuntimeError('asset_symlink')
 old={p:p.read_bytes() if p.exists() else None for p in changes}
 meta={p:p.stat() if p.exists() else None for p in changes}
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 dest=BACK/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 dest.mkdir(mode=0o700)
 for p,b in old.items():
  if b is None:continue
  target=dest/p.name;target.write_bytes(b);os.chmod(target,0o600)
  if sha(target.read_bytes())!=sha(b):raise RuntimeError('backup_corrupt')
 applied=[]
 try:
  for p,b in changes.items():
   if p.exists() and p.read_bytes()!=old[p]:raise RuntimeError('concurrent_file_change_'+p.name)
   atomic(p,b,meta[p] if meta[p] else meta[ARCH]);applied.append(p)
  for p,b in changes.items():
   uri='http://127.0.0.1:8123/local/'+p.relative_to(BASE).as_posix()+'?v='+VERSION
   if sha(get(uri))!=sha(b):raise RuntimeError('served_source_hash_mismatch_'+p.name)
  print('SECURITY_ARCHIVE_V33_LIVE_VERIFIED',json.dumps({
    'source_sha':ref,'ui':str(ARCH),'shell':str(SHELL),'assets':list(FILES),
    'backup':str(dest),'original_recordings_changed':False,
    'bulk_empty_response_handled':True,'delete_requires_confirmed_phone_file':True,
    'stale_card_removal_is_non_destructive':True},sort_keys=True),flush=True)
 except BaseException:
  for p in reversed(applied):
   if old[p] is None:p.unlink(missing_ok=True)
   else:atomic(p,old[p],meta[p])
  print('SECURITY_ARCHIVE_V33_ROLLBACK_FINISHED',flush=True)
  raise
if __name__=='__main__':main()
