"""S9 microSD replay extension for the existing C720P secure archive proxy."""
import json,re,urllib.parse,subprocess
from pathlib import Path
BASE=Path("/opt/homeassistant/config/www/frontyard-security-new")
CAT=BASE/"s9-phone-events.json"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
PHONE="192.168.178.250:5555"
RE_NAME=re.compile(r"rec_20[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}[.]mp4")
BLOCK=65536
def rows():
 try:
  d=json.loads(CAT.read_text())
  return {r["name"]:r for r in d.get("phone_recordings",[]) if RE_NAME.fullmatch(str(r.get("name",""))) and r.get("sd_verified")}
 except Exception:return {}
def install_local_sd(H):
 original=H.go
 def go(self):
  url=urllib.parse.urlsplit(self.path)
  path=url.path
  data=rows()
  if path=="/new/api/saved":
   events=[]
   for name,r in sorted(data.items(),reverse=True):
    events.append({"camera":"new","clip_no":name,"timestamp":r.get("timestamp"),"reason":"S9+ microSD local recording",
      "method":"s9-microSD","remote_name":name,"snapshot_name":name+".thumb.jpg",
      "size":r.get("size"),"person_status":"unreviewed","scene_category":r.get("scene_category","unreviewed")})
   self.js(200,{"ok":True,"camera":"new","archive_mode":"S9-microSD-only","drive_ready":False,"events":events})
   return
  match=re.fullmatch(r"/new/saved/clip/(rec_20[0-9-]+_[0-9-]+[.]mp4)",path)
  if match:
   name=match.group(1);item=data.get(name)
   if item:return play_sd(self,name,item)
  snap=re.fullmatch(r"/new/saved/snap/(rec_20[0-9-]+_[0-9-]+[.]mp4[.]thumb[.]jpg)",path)
  if snap:
   name=snap.group(1)
   source=BASE/"s9-phone-thumbs"/name
   if source.is_file() and name[:-10] in data:
    return self.local_file(source,"image/jpeg")
  return original(self)
 H.go=go
def play_sd(handler,name,record):
 size=int(record.get("size") or 0)
 if size<10000 or size>4*1024*1024*1024:
  handler.js(404,{"ok":False,"error":"invalid_clip"});return
 header=handler.headers.get("Range","").strip()
 first=0;last=size-1;code=200
 if header:
  match=re.fullmatch(r"bytes=([0-9]*)-([0-9]*)",header)
  if not match:
   handler.send_response(416);handler.send_header("Content-Range",f"bytes */{size}");handler.end_headers();return
  a,b=match.groups()
  if a:first=int(a);last=min(size-1,int(b)) if b else last
  elif b:first=max(0,size-int(b))
  if first<0 or first>=size or last<first:
   handler.send_response(416);handler.send_header("Content-Range",f"bytes */{size}");handler.end_headers();return
  code=206
 count=last-first+1
 if handler.command=="HEAD":
  return media_headers(handler,code,size,first,last,count)
 shift=first%BLOCK
 chunks=last//BLOCK-first//BLOCK+1
 args=["adb","-s",PHONE,"exec-out","dd","if="+SD+"/"+name,
       "bs="+str(BLOCK),"skip="+str(first//BLOCK),"count="+str(chunks)]
 try:proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 except Exception:
  handler.js(503,{"ok":False,"error":"phone_offline"});return
 try:
  ignored=proc.stdout.read(shift)
  if len(ignored)!=shift:raise OSError("seek")
  lead=proc.stdout.read(min(count,32768))
  if not lead:raise OSError("empty_video")
 except Exception:
  proc.kill();handler.js(503,{"ok":False,"error":"microSD_not_reachable"});return
 media_headers(handler,code,size,first,last,count)
 remaining=count
 try:
  handler.wfile.write(lead);remaining-=len(lead)
  while remaining>0:
   part=proc.stdout.read(min(65536,remaining))
   if not part:break
   handler.wfile.write(part);remaining-=len(part)
 except (BrokenPipeError,ConnectionResetError):pass
 finally:
  if proc.poll() is None:proc.terminate()
def media_headers(handler,code,size,start,end,length):
 handler.send_response(code)
 handler.send_header("Content-Type","video/mp4")
 handler.send_header("Accept-Ranges","bytes")
 handler.send_header("Content-Length",str(length))
 handler.send_header("Cache-Control","private,no-store")
 handler.send_header("X-Content-Type-Options","nosniff")
 if code==206:handler.send_header("Content-Range",f"bytes {start}-{end}/{size}")
 handler.end_headers()
