#!/usr/bin/env python3
"""Guarded playback route for on-phone S9+ pre-event-combined MP4s.

Only exposes /new/saved/complete/motion_<epoch>.mp4 when its verified 4K
original exists in the existing archive index. Does not touch media files.
"""
from pathlib import Path
import datetime,os,re,json,stat,tempfile,subprocess,time,urllib.request
ROOT=Path('/home/jespern/c720p-home-hub/bin')
F=ROOT/'s9_sd_proxy_extension.py'
R=ROOT/'c720p-lan-camera-relay.py'
BACK=Path('/home/jespern/c720p-home-hub/backups/s9-preroll-complete-route-v1')
EXT_ANCHOR='  snap=re.fullmatch(r"/new/saved/snap/([A-Za-z0-9._-]+[.]mp4[.]thumb[.]jpg)",path)'
RELAY_ANCHOR="   m=re.fullmatch(r'/(new)/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)"
EXT='''  # S9_JOINED_PREROLL_V1: read-only complete segment for indexed original.
  joined=re.fullmatch(r"/new/saved/complete/(motion_[0-9]{13}[.]mp4)",path)
  if joined:
   original=joined.group(1);record=data.get(original)
   if record:
    nm=original+".complete.mp4"
    try:
     req=urllib.request.Request("http://127.0.0.1:18808/clip/"+nm,method="HEAD")
     with urllib.request.urlopen(req,timeout=9) as response:
      if response.status!=200 or "video/mp4" not in response.headers.get("Content-Type",""):
       raise ValueError("not_video")
      size=int(response.headers.get("Content-Length","0"))
     if 25000<size<260000000:return play_sd(self,nm,{**record,"size":size})
    except (ValueError,TypeError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError):pass
   self.js(404,{"ok":False,"error":"complete_video_not_yet_available"});return
'''
RELAY='''   # S9_JOINED_PREROLL_SIGNED_V1: indexed on-phone derivatives, after auth.
   m=re.fullmatch(r'/(new)/saved/preroll/(motion_[0-9]{13}[.]mp4)',path)
   if m:return self.archive(m.group(1),'/saved/preroll/'+m.group(2),head)
   m=re.fullmatch(r'/(new)/saved/complete/(motion_[0-9]{13}[.]mp4)',path)
   if m:return self.archive(m.group(1),'/saved/complete/'+m.group(2),head)
'''
def atomic(path,raw,st):
 fd,p=tempfile.mkstemp(prefix='.s9-joined-route-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(p,stat.S_IMODE(st.st_mode))
  try:os.chown(p,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(p,path)
 finally:
  if os.path.exists(p):os.unlink(p)
def restart(unit):
 result=subprocess.run(['systemctl','--user','restart',unit],capture_output=True,text=True,timeout=48)
 if result.returncode:raise RuntimeError('restart_failed_'+unit+result.stderr[-130:])
def get(path):
 try:
  with urllib.request.urlopen('http://127.0.0.1:8794'+path,timeout=19) as r:return r.status,r.headers,r.read(2500000)
 except urllib.error.HTTPError as e:return e.code,e.headers,e.read(1000)
def count(kind):
 code,_,raw=get('/new/api/'+kind)
 if code!=200:raise RuntimeError('catalog_unavailable_'+kind)
 return len(json.loads(raw)['events'])
def main():
 old={F:F.read_bytes(),R:R.read_bytes()}
 strings={F:old[F].decode(),R:old[R].decode()}
 if (strings[F].count(EXT_ANCHOR)!=1 or
     strings[R].count(RELAY_ANCHOR)!=1 or
     'S9_JOINED_PREROLL_V1' in strings[F] or 'S9_JOINED_PREROLL_SIGNED_V1' in strings[R]):
  raise RuntimeError('unexpected_live_relay_source')
 files={F:strings[F].replace(EXT_ANCHOR,EXT+EXT_ANCHOR,1).encode(),
        R:strings[R].replace(RELAY_ANCHOR,RELAY+RELAY_ANCHOR,1).encode()}
 for p,x in files.items():compile(x.decode(),str(p),'exec')
 prior={kind:count(kind) for kind in ('saved','drive-saved')}
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 d=BACK/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 d.mkdir(mode=0o700)
 st={p:p.stat() for p in files}
 for p,raw in old.items():(d/p.name).write_bytes(raw)
 written=[]
 try:
  for p,raw in files.items():
   if p.read_bytes()!=old[p]:raise RuntimeError('concurrent_edit')
   atomic(p,raw,st[p]);written.append(p)
  restart('c720p-drive-security-archive.service')
  restart('c720p-lan-camera-relay.service')
  for attempt in range(12):
   try:
    after={kind:count(kind) for kind in prior}
    if any(after[k]<prior[k] for k in prior):raise RuntimeError('catalog_regressed')
    code,_,_=get('/new/saved/complete/motion_0000000000000.mp4')
    if code!=404:raise RuntimeError('unindexed_complete_not_denied')
    code,_,_=get('/new/saved/clip/motion_1791910606764.mp4?playback=prepare')
    if code!=200:raise RuntimeError('existing_playback_broken')
    print('S9_JOINED_VIDEO_SIGNED_ROUTE_READY',json.dumps(
     {'old_counts':prior,'new_counts':after,'unindexed_denied':True,
      'backup':str(d),'original_media_preserved':True},sort_keys=True),flush=True)
    return
   except Exception:time.sleep(1)
  raise RuntimeError('live_route_readback_failed')
 except BaseException:
  for p in reversed(written):
   atomic(p,old[p],st[p])
  for u in ('c720p-drive-security-archive.service','c720p-lan-camera-relay.service'):
   try:restart(u)
   except Exception:pass
  print('S9_JOINED_ROUTE_ROLLED_BACK',flush=True)
  raise
if __name__=='__main__':main()
