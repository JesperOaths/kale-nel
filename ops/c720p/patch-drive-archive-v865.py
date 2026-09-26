#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import datetime
import shutil

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-drive-security-archive.py")

def main():
    src=TARGET.read_text()
    original=src

    src=src.replace(
        "import json,hashlib,pathlib,re,subprocess,urllib.parse,os,threading,configparser,datetime",
        "import json,hashlib,pathlib,re,subprocess,urllib.parse,os,threading,configparser,datetime,time",
        1,
    )
    src=src.replace(
        "CACHE_MAX=192*1024*1024; CACHE_LOCK=threading.Lock()",
        "CACHE_MAX=192*1024*1024; CACHE_LOCK=threading.Lock(); REMOTE_INV_LOCK=threading.Lock(); REMOTE_INV={}; REMOTE_INV_TTL=300",
        1,
    )

    helper=r'''
def cached_file(cam,row):
 name=safe(row.get('remote_name')); expected_size=int(row.get('size') or 0); expected_md5=str(row.get('md5') or '').lower()
 if not name or expected_size<=0:return None
 dst=CACHE/cam/name
 if not dst.is_file() or dst.stat().st_size!=expected_size:return None
 if expected_md5 and file_md5(dst)!=expected_md5:return None
 try:os.utime(dst,None)
 except:pass
 return dst

def remote_inventory(cam,force=False):
 now=time.monotonic()
 with REMOTE_INV_LOCK:
  old=REMOTE_INV.get(cam)
  if old and not force and now-float(old.get('at',0))<REMOTE_INV_TTL:return set(old.get('names') or ())
 c=cfg()
 try:
  r=subprocess.run([c['rclone'],'--config',c['rclone_config'],'lsjson',c['remote']+':','--drive-root-folder-id',str(c['folders'][cam]['id']),'--files-only'],text=True,capture_output=True,timeout=90)
  if r.returncode:return None
  rows=json.loads(r.stdout) if r.stdout.strip() else []
  names={str(x.get('Name') or '') for x in rows if isinstance(x,dict) and x.get('Name')}
 except Exception:return None
 with REMOTE_INV_LOCK:REMOTE_INV[cam]={'at':now,'names':tuple(names)}
 return names

def reconcile_remote(cam):
 names=remote_inventory(cam)
 if names is None:return 0
 d=index();changed=0;removed=[]
 stamp=datetime.datetime.now().astimezone().isoformat()
 for x in d.get('items',[]):
  if x.get('camera')!=cam or x.get('state')!='verified':continue
  name=safe(x.get('remote_name'))
  if name and name not in names:
   x['state']='deleted';x['deleted_at']=stamp;x['delete_reason']='remote_missing';changed+=1;removed.append((name,safe(x.get('snapshot_name'))))
 if changed:
  atomic_index(d)
  for name,snap in removed:
   for f in (CACHE/cam/name,TH/cam/snap if snap else None):
    try:
     if f and f.is_file():f.unlink()
    except Exception:pass
 return changed

'''
    if "def cached_file(cam,row):" not in src:
        pos=src.find("class H(BaseHTTPRequestHandler):")
        if pos<0: raise RuntimeError("class anchor not found")
        src=src[:pos]+helper+src[pos:]

    old="   cam=m.group(1);ok,why=remote_ready(); rows=[]\n   for x in sorted(items(cam),key=lambda z:str(z.get('timestamp','')),reverse=True):"
    new="   cam=m.group(1);ok,why=remote_ready(); rows=[]\n   if ok:reconcile_remote(cam)\n   for x in sorted(items(cam),key=lambda z:str(z.get('timestamp','')),reverse=True):"
    if old in src:
        src=src.replace(old,new,1)
    elif "if ok:reconcile_remote(cam)" not in src:
        raise RuntimeError("saved-list anchor not found")

    start=src.find(" def remote_file(self,cam,row):")
    end=src.find("\nc=cfg();ThreadingHTTPServer",start)
    if start<0 or end<0: raise RuntimeError(f"remote block anchors not found: {start},{end}")

    new_remote=r''' def remote_file(self,cam,row):
  size=int(row.get('size') or 0);name=safe(row.get('remote_name'))
  if not name or size<=0:self.js(404,{'ok':False,'error':'not_found'});return
  a=0;b=size-1;code=200;rh=self.headers.get('Range','')
  if rh:
   m=re.fullmatch(r'bytes=(\d*)-(\d*)',rh.strip())
   if not m:self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return
   x,y=m.groups()
   if x:a=int(x);b=int(y) if y else b
   elif y:a=max(0,size-int(y))
   if a<0 or a>=size or b<a:self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return
   b=min(b,size-1);code=206
  ln=b-a+1
  f=cached_file(cam,row)
  if self.command=='HEAD':
   self.media_headers(code,size,a,b,ln);return
  if f:
   self.media_headers(code,size,a,b,ln)
   with f.open('rb') as q:
    q.seek(a);remain=ln
    while remain:
     data=q.read(min(65536,remain))
     if not data:break
     try:self.wfile.write(data)
     except (BrokenPipeError,ConnectionResetError):break
     remain-=len(data)
   return
  c=cfg()
  cmd=[c['rclone'],'--config',c['rclone_config'],'cat',c['remote']+':'+name,'--drive-root-folder-id',str(c['folders'][cam]['id']),'--offset',str(a),'--count',str(ln)]
  try:p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  except Exception:self.js(503,{'ok':False,'error':'drive_archive_stream_failed'});return
  first=p.stdout.read(1) if p.stdout else b''
  if not first:
   try:p.wait(timeout=10)
   except Exception:pass
   names=remote_inventory(cam,True);missing=names is not None and name not in names
   if missing:reconcile_remote(cam)
   self.js(404 if missing else 503,{'ok':False,'error':'drive_archive_missing' if missing else 'drive_archive_stream_failed'});return
  self.media_headers(code,size,a,b,ln)
  remain=ln
  try:
   self.wfile.write(first);remain-=1
   while remain and p.stdout:
    data=p.stdout.read(min(65536,remain))
    if not data:break
    self.wfile.write(data);remain-=len(data)
  except (BrokenPipeError,ConnectionResetError):
   pass
  finally:
   try:
    if p.poll() is None:p.terminate()
   except Exception:pass

 def media_headers(self,code,size,a,b,ln):
  self.send_response(code);self.send_header('Content-Type','video/mp4');self.send_header('Content-Length',str(ln));self.send_header('Accept-Ranges','bytes')
  if code==206:self.send_header('Content-Range',f'bytes {a}-{b}/{size}')
  self.send_header('Cache-Control','private, no-store');self.end_headers()
'''
    src=src[:start]+new_remote+src[end:]

    if src==original:
        return
    stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(TARGET,TARGET.with_name(TARGET.name+f".before-v865-stream-{stamp}"))
    tmp=TARGET.with_suffix(".py.v865.tmp")
    tmp.write_text(src)
    tmp.replace(TARGET)

if __name__=="__main__":
    main()
