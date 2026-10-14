#!/usr/bin/env python3
"""Guardedly enable joined/pre-roll-first player across all Security pages."""
from pathlib import Path
import hashlib,datetime,os,re,stat,tempfile,urllib.request
B=Path('/opt/homeassistant/config/www');F=B/'frontyard-security-new'
JS=[B/'security-video-playback.js',F/'security-video-playback-v30.js']
D=Path('/home/jespern/c720p-home-hub/backups/s9-prepended-player-v1')
COMMIT='63889dcf9ff5234fb643ee3cee463c0d2c3198b7'
URL='https://raw.githubusercontent.com/JesperOaths/kale-nel/'+COMMIT+'/ops/c720p/s9-native-security/security-prepended-player-v1.snippet.js'
V='s9-prepended-player-v1-20261013'
def checksum(b):return hashlib.sha256(b).hexdigest()
def save(p,b,st):
 fd,t=tempfile.mkstemp(prefix='.s9-prepend-',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  os.chmod(t,stat.S_IMODE(st.st_mode))
  try:os.chown(t,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(t,p)
 finally:
  if os.path.exists(t):os.unlink(t)
def main():
 with urllib.request.urlopen(URL,timeout=28) as r:snippet=r.read(4000).decode()
 if not (1000<len(snippet)<3500 and 'S9_COMPLETE_PREPENDED_MP4_V1' in snippet):
  raise RuntimeError('unexpected_pinned_hook')
 new={}
 for p in JS:
  t=p.read_text()
  start=t.index('async function setSource(video,path,options={}){')
  anchor='controls(video,state);renderState(state);'
  ix=t.index(anchor,start)
  if 'S9_COMPLETE_PREPENDED_MP4_V1' in t or t.index('try{',ix)-ix>80:
   raise RuntimeError('shared_player_contract')
  t=t[:ix+len(anchor)]+'\n'+snippet+'\n'+t[ix+len(anchor):]
  new[p]=t.encode()
 for p in [B/'c720p-surveillance.html',*F.glob('*.html')]:
  if not p.is_file() or p.is_symlink():continue
  t=p.read_text()
  if 'security-video-playback' not in t:continue
  t,n=re.subn(r'(security-video-playback(?:-v30)?[.]js)(?:[?]v=[A-Za-z0-9._-]+)?',
    lambda m:m.group(1)+'?v='+V,t)
  if n:new[p]=t.encode()
 if len(new)<8:raise RuntimeError('not_enough_video_pages')
 old={p:p.read_bytes() for p in new};st={p:p.stat() for p in new}
 D.mkdir(mode=0o700,parents=True,exist_ok=True)
 back=D/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 back.mkdir(mode=0o700)
 for p,b in old.items():
  f=back/p.relative_to(B);f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
  if checksum(f.read_bytes())!=checksum(b):raise RuntimeError('backup_failed')
 written=[]
 try:
  for p,b in new.items():
   if p.read_bytes()!=old[p]:raise RuntimeError('concurrent_edit')
   save(p,b,st[p]);written.append(p)
  for p,b in new.items():
   with urllib.request.urlopen('http://127.0.0.1:8123/local/'+str(p.relative_to(B))+'?v='+V,timeout=18) as r:data=r.read(300001)
   if checksum(b)!=checksum(data):raise RuntimeError('ha_readback_mismatch')
  print('S9_PHONE_PREBUFFER_FIRST_PLAYER_DEPLOYED',
   {'files':len(new),'combined_prioritized':True,
    'prebuffer_sequential_fallback':True,'4k_unchanged':True},flush=True)
 except BaseException:
  for p in reversed(written):save(p,old[p],st[p])
  raise
if __name__=='__main__':main()
