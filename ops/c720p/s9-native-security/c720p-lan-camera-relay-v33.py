#!/usr/bin/env python3
import base64,hashlib,hmac,ipaddress,json,re,socket,time,threading,urllib.parse,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
UP={'new':8793}; PORT=8794
BATTERY_STATE=Path('/opt/homeassistant/config/www/c720p-phone-battery.json')
LAN=ipaddress.ip_network('192.168.178.0/24')
SECRET=bytes.fromhex(Path('/home/jespern/.config/c720p-lan-camera-relay/auth_secret').read_text().strip())
TOKEN_TTL=300
AUTH_VALIDATION_CACHE={}
# Serialize HA bearer validation. ThreadingHTTPServer can receive several /auth
# requests at once; without this lock, identical stale tokens all miss the cache
# concurrently and each bad /api/ request counts toward Home Assistant IP bans.
AUTH_VALIDATION_LOCK=threading.Lock()
GOOD_HOSTS={'127.0.0.1','localhost','192.168.178.141','jesper-hub','jesper-hub.local'}
def ha_validation_url():
 try:
  s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
  try:
   s.connect(('1.1.1.1',9)); ip=s.getsockname()[0]
  finally:s.close()
  if ipaddress.ip_address(ip) in LAN:return f'http://{ip}:8123/api/'
 except Exception:pass
 # Fail toward the hub LAN identity, never loopback: a bad client bearer must
 # not be able to place 127.0.0.1 into Home Assistant's IP-ban list.
 return 'http://192.168.178.141:8123/api/'
def bearer_shape_fresh(a):
 try:
  tok=a.split(' ',1)[1]; parts=tok.split('.')
  if len(parts)!=3:return False
  raw=parts[1]+'='*((4-len(parts[1])%4)%4)
  payload=json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
  exp=float(payload.get('exp') or 0); iat=float(payload.get('iat') or 0)
  now=time.time()
  return bool(exp>now+5 and iat>0 and iat<=now+60 and payload.get('iss'))
 except Exception:return False
def b64(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
def mint(ip):
 exp=int(time.time())+TOKEN_TTL; msg=f'{ip}|{exp}'.encode(); sig=b64(hmac.new(SECRET,msg,hashlib.sha256).digest()); return f'{exp}.{sig}',exp
def verify(ip,tok):
 try:
  a,sig=tok.split('.',1); exp=int(a)
  if exp<int(time.time()) or exp>int(time.time())+TOKEN_TTL+30:return False
  want=b64(hmac.new(SECRET,f'{ip}|{exp}'.encode(),hashlib.sha256).digest())
  return hmac.compare_digest(sig,want)
 except Exception:return False
class H(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a): pass
 def client_ip(self): return self.client_address[0]
 def allowed_net(self):
  try:return ipaddress.ip_address(self.client_ip()) in LAN or self.client_ip() in ('127.0.0.1','::1')
  except:return False
 def loopback(self): return self.client_ip() in ('127.0.0.1','::1')
 def origin_ok(self):
  o=self.headers.get('Origin','')
  if not o:return False
  try:
   u=urllib.parse.urlsplit(o); return u.scheme=='http' and (u.port or 80)==8123 and (u.hostname or '').lower() in GOOD_HOSTS
  except:return False
 def cors(self):
  o=self.headers.get('Origin','')
  if self.origin_ok():self.send_header('Access-Control-Allow-Origin',o);self.send_header('Vary','Origin')
 def bearer_valid(self):
  a=self.headers.get('Authorization','')
  if not a.startswith('Bearer ') or len(a)<20:return False
  # Fast fail expired/malformed access tokens locally. This is only a prefilter;
  # fresh-looking tokens are still authenticated by Home Assistant below.
  if not bearer_shape_fresh(a):return False
  key=hashlib.sha256(a.encode()).hexdigest()
  # The lock deliberately covers the upstream HA check. This makes cache lookup
  # + validation atomic and prevents a burst of identical stale bearer tokens
  # from tripping Home Assistant's loopback IP-ban threshold.
  with AUTH_VALIDATION_LOCK:
   cached=AUTH_VALIDATION_CACHE.get(key)
   now=time.time()
   if cached is not None:
    ok,ts=cached
    if not ok:return False
    if now-ts<60:return True
   req=urllib.request.Request(ha_validation_url(),headers={'Authorization':a,'Accept':'application/json'})
   try:
    with urllib.request.urlopen(req,timeout=4) as r:
     ok=r.status==200
     AUTH_VALIDATION_CACHE[key]=(ok,now)
     return ok
   except urllib.error.HTTPError as e:
    if e.code in (401,403):AUTH_VALIDATION_CACHE[key]=(False,now)
    return False
   except Exception:return False
 def relay_token(self):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  return self.headers.get('X-C720P-Relay-Token','') or (q.get('auth') or [''])[0]
 def authorized(self): return self.allowed_net() and (self.loopback() or verify(self.client_ip(),self.relay_token()))
 def empty(self,code): self.send_response(code);self.cors();self.send_header('Cache-Control','no-store');self.send_header('Content-Length','0');self.end_headers()
 def do_OPTIONS(self):
  if not self.allowed_net() or not self.origin_ok(): return self.empty(403)
  self.send_response(204);self.cors();self.send_header('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type,X-C720P-Relay-Token,X-S9-Camera-Control-Intent,X-S9-Archive-Delete-Intent,X-S9-Person-Folder-Intent,X-S9-Archive-Review-Intent,X-S9-Verified-People-Intent');self.send_header('Access-Control-Max-Age','300');self.send_header('Content-Length','0');self.end_headers()
 def do_POST(self):
  path=urllib.parse.urlsplit(self.path).path
  if path.startswith('/s3/'):
   return self.empty(410)
  if path=='/auth':
   if not self.allowed_net() or not self.origin_ok() or not self.bearer_valid(): return self.empty(403)
   tok,exp=mint(self.client_ip()); data=json.dumps({'ok':True,'token':tok,'expires':exp}).encode()
   self.send_response(200);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if not self.authorized(): return self.empty(401)
  if path=='/new/api/verified-people/review':
   if not self.origin_ok() or self.headers.get('X-S9-Verified-People-Intent')!='owner-folder-review-v33':return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 2<=n<=1500 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(400)
    request=urllib.request.Request('http://127.0.0.1:8795/new/api/verified-people/review',data=self.rfile.read(n),headers={'Content-Type':'application/json','Origin':self.headers['Origin'],'X-S9-Verified-People-Intent':'owner-folder-review-v33'},method='POST')
    try:response=urllib.request.urlopen(request,timeout=20)
    except urllib.error.HTTPError as error:response=error
    with response:
     data=response.read(16000);self.send_response(response.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    return
   except Exception:return self.empty(502)
  if path=='/new/api/archive-review/batch':
   if not self.origin_ok() or self.headers.get('X-S9-Archive-Review-Intent')!='human-recording-review-v32':return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 2<=n<=18000 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(400)
    request=urllib.request.Request('http://127.0.0.1:8795/new/api/archive-review/batch',data=self.rfile.read(n),headers={'Content-Type':'application/json','Origin':self.headers['Origin'],'X-S9-Archive-Review-Intent':'human-recording-review-v32'},method='POST')
    try:response=urllib.request.urlopen(request,timeout=20)
    except urllib.error.HTTPError as error:response=error
    with response:
     data=response.read(18000);self.send_response(response.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    return
   except Exception:return self.empty(502)
  if path=='/new/api/person-folders/review':
   if not self.origin_ok() or self.headers.get('X-S9-Person-Folder-Intent')!='explicit-review-v31':return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 2<=n<=1200 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(400)
    req=urllib.request.Request('http://127.0.0.1:8795/new/api/person-folders/review',data=self.rfile.read(n),headers={'Content-Type':'application/json','Origin':self.headers['Origin'],'X-S9-Person-Folder-Intent':'explicit-review-v31'},method='POST')
    try:r=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as e:r=e
    with r:
     data=r.read(16000);self.send_response(r.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    return
   except Exception:return self.empty(502)
  # C720P_SD_EXPLICIT_DELETE_V1: owner action, fixed localhost upstream, no bulk.
  if path=='/new/api/sd/delete':
   if not self.origin_ok() or self.headers.get('X-S9-Archive-Delete-Intent')!='explicit-user-delete-v1':
    return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 30<=n<=512 or 'application/json' not in self.headers.get('Content-Type','').lower():
     return self.empty(400)
    body=self.rfile.read(n)
    req=urllib.request.Request('http://127.0.0.1:8795/new/api/sd/delete',
      data=body,headers={'Content-Type':'application/json'},method='POST')
    try:response=urllib.request.urlopen(req,timeout=75)
    except urllib.error.HTTPError as error:response=error
    with response:
     data=response.read(16000)
     self.send_response(response.status);self.cors()
     self.send_header('Content-Type','application/json')
     self.send_header('Cache-Control','no-store')
     self.send_header('Content-Length',str(len(data)));self.end_headers()
     self.wfile.write(data)
    return
   except Exception:
    return self.empty(502)
  m=re.fullmatch(r'/(new)/api/saved/delete',path)
  if m:
   if not self.origin_ok() or self.headers.get('X-S9-Archive-Delete-Intent')!='explicit-user-delete-v1':return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if n<1 or n>4096:raise ValueError('bad length')
    body=self.rfile.read(n)
    req=urllib.request.Request(f'http://127.0.0.1:8795/{m.group(1)}/api/saved/delete',data=body,headers={'Content-Type':'application/json'},method='POST')
    try:r=urllib.request.urlopen(req,timeout=190)
    except urllib.error.HTTPError as e:r=e
    data=r.read(512000);self.send_response(r.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
   except Exception:
    data=b'{"ok":false,"error":"archive_delete_unavailable"}';self.send_response(502);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  # Native Camera2 controls: only from a deliberate UI selection, never automatic
  if path=='/new/camera-control':
   if not self.origin_ok() or self.headers.get('X-S9-Camera-Control-Intent')!='explicit-user-selection-v1':return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 2<=n<=256 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(415)
    body=self.rfile.read(n);d=json.loads(body)
    if not isinstance(d,dict) or set(d)!={'key','value'} or not isinstance(d['key'],str) or not isinstance(d['value'],str):return self.empty(400)
    if d['key'] not in ('zoom','exposure_ev','torch','focus','recording_rotation','garden_zone'):return self.empty(400)
    header={'Content-Type':'application/json','X-S9-Camera-Control-Intent':'explicit-user-selection-v1'}
    if self.headers.get('Origin'):header['Origin']=self.headers['Origin']
    req=urllib.request.Request('http://127.0.0.1:8795/new/camera-control',data=body,headers=header,method='POST')
    try:r=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as e:r=e
    data=r.read(8192);self.send_response(r.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
   except Exception:return self.empty(502)
  parts=path.strip('/').split('/')
  if len(parts)!=2 or parts[0] not in UP or parts[1]!='camera-control': return self.empty(404)
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<1 or n>8192: raise ValueError('bad length')
   body=self.rfile.read(n)
   req=urllib.request.Request(f'http://127.0.0.1:{UP[parts[0]]}/camera-control',data=body,headers={'Content-Type':'application/json'},method='POST')
   with urllib.request.urlopen(req,timeout=8) as r:data=r.read(512000);ct=r.headers.get('Content-Type','application/json');code=r.status
   self.send_response(code);self.cors();self.send_header('Content-Type',ct);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  except Exception:
   data=b'{"ok":false,"error":"control_unavailable"}';self.send_response(502);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def local_recorder(self,cam,path,head=False):
  # Authenticated LAN bridge for Home Assistant pages loaded from another LAN
  # browser. The recorders stay bound to 127.0.0.1; this exposes only the
  # intended UI surface through the same short-lived relay token used by live.
  u=urllib.parse.urlsplit(self.path); qs=('?'+u.query) if u.query else ''
  # S9_NATIVE_SECURITY_RELAY_V1: switch only S9 authenticated live path.
  if cam=='new' and path=='/live.mjpg' and Path('/home/jespern/c720p-home-hub/state/s9-native-security-active.flag').is_file():
   url='http://127.0.0.1:18808/mjpeg'
  else:
   url=f'http://127.0.0.1:{UP[cam]}{path}{qs}'
  req=urllib.request.Request(url,method='HEAD' if head else 'GET')
  rh=self.headers.get('Range')
  if rh:req.add_header('Range',rh)
  try:r=urllib.request.urlopen(req,timeout=8 if path!='/live.mjpg' else 20)
  except urllib.error.HTTPError as e:r=e
  except Exception:return self.empty(502)
  self.send_response(r.status);self.cors()
  for h in ('Content-Type','Content-Length','Content-Range','Accept-Ranges'):
   v=r.headers.get(h)
   if v:self.send_header(h,v)
  self.send_header('Cache-Control','private, no-store');self.send_header('Connection','close');self.end_headers()
  if head:return
  try:
   while True:
    b=r.read(65536)
    if not b:break
    self.wfile.write(b);self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError):pass
 def archive(self,cam,subpath,head=False):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  playback=(q.get('playback') or [''])[0]
  if subpath=='/api/archive-review':
   sources=q.get('source') or ['sd']
   if len(sources)!=1 or sources[0] not in ('sd','drive'):return self.empty(400)
   suffix='?source='+sources[0]
  # C720P_AUTHENTICATED_RGB565_RELAY_V23: no arbitrary query passthrough
  elif playback in ('rgb_prepare','rgb_pack'):
   chunks=q.get('chunk') or ['0']
   if len(chunks)!=1 or not re.fullmatch(r'(?:[0-9]|[1-5][0-9])',chunks[0]):
    return self.empty(400)
   suffix='?playback='+playback+'&chunk='+chunks[0]
  else:
   suffix=('?playback='+playback) if playback in ('prepare','hub') else ''
  url=f'http://127.0.0.1:8795/{cam}{subpath}{suffix}';req=urllib.request.Request(url,method='HEAD' if head else 'GET');rh=self.headers.get('Range')
  if rh:req.add_header('Range',rh)
  try:r=urllib.request.urlopen(req,timeout=8)
  except urllib.error.HTTPError as e:r=e
  except Exception:return self.empty(502)
  self.send_response(r.status);self.cors()
  for h in ('Content-Type','Content-Length','Content-Range','Accept-Ranges'):
   v=r.headers.get(h)
   if v:self.send_header(h,v)
  self.send_header('Cache-Control','private, no-store');self.send_header('Connection','close');self.end_headers()
  if head:return
  try:
   while True:
    b=r.read(65536)
    if not b:break
    self.wfile.write(b)
  except (BrokenPipeError,ConnectionResetError):pass
 def smooth_live(self,head=False):
  # S9_SMOOTH_LIVE_RELAY_V1: authentication is checked by go() first.
  # Fixed loopback destination: no browser-controlled upstream URL or source.
  req=urllib.request.Request('http://127.0.0.1:1985/api/stream.mp4?src=s9',
    headers={'User-Agent':'C720P Chrome/154'},method='HEAD' if head else 'GET')
  try:r=urllib.request.urlopen(req,timeout=15)
  except Exception:return self.empty(503)
  self.send_response(r.status);self.cors()
  self.send_header('Content-Type',r.headers.get('Content-Type','video/mp4'))
  self.send_header('Cache-Control','private,no-store')
  self.send_header('X-Content-Type-Options','nosniff')
  self.send_header('Connection','close');self.end_headers()
  self.close_connection=True
  try:
   if not head:
    while True:
     chunk=r.read1(8192)
     if not chunk:break
     self.wfile.write(chunk);self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
  finally:r.close()
 def do_HEAD(self): self.go(True)
 def do_GET(self): self.go(False)
 def go(self,head=False):
  path=urllib.parse.urlsplit(self.path).path
  if path.startswith('/s3/'):
   return self.empty(410)
  if not self.authorized(): return self.empty(401)
  if path=='/new/live.mp4':return self.smooth_live(head)
  if path=='/phone-batteries.json':
   try:
    data=BATTERY_STATE.read_bytes(); json.loads(data.decode())
    self.send_response(200);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','private, no-store');self.send_header('Content-Length',str(len(data)));self.end_headers()
    if not head:self.wfile.write(data)
   except Exception:
    data=b'{\"ok\":false,\"error\":\"battery_state_unavailable\"}';self.send_response(503);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers()
    if not head:self.wfile.write(data)
   return
  if path=='/new/api/person-folders':return self.archive('new','/api/person-folders',head)
  if path=='/new/api/archive-review':return self.archive('new','/api/archive-review',head)
  if path=='/new/api/verified-people' or re.fullmatch(r'/new/api/verified-people/image/[a-f0-9]{24}[.]jpg',path):return self.archive('new',path[len('/new'):],head)
  # SECURITY_NATIVE_READONLY_TELEMETRY_V14 — existing JSON archive proxy, no writes
  m=re.fullmatch(r'/(new)/api/live-person-watch',path)
  if m:return self.archive(m.group(1),'/api/live-person-watch',head)
  # SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16: after authorized(), never writes
  # SECURITY_DRIVE_PERSON_READONLY_V22 — existing authenticated LAN relay / no writes
  m=re.fullmatch(r'/(new)/api/drive-person-review',path)
  if m:return self.archive(m.group(1),'/api/drive-person-review',head)
  m=re.fullmatch(r'/(new)/api/drive-saved',path)
  if m:return self.archive(m.group(1),'/api/drive-saved',head)
  m=re.fullmatch(r'/(new)/drive/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)
  if m:return self.archive(m.group(1),'/drive/saved/'+m.group(2)+'/'+urllib.parse.quote(m.group(3)),head)
  # SECURITY_NATIVE_CAMERA2_RELAY_V18: authenticated GET, read-only metadata
  m=re.fullmatch(r'/(new)/camera-controls',path)
  if m:return self.archive(m.group(1),'/camera-controls',head)
  m=re.fullmatch(r'/(new)/api/saved',path)
  if m:return self.archive(m.group(1),'/api/saved',head)
  # S9_JOINED_PREROLL_SIGNED_V1: indexed on-phone derivatives, after auth.
  m=re.fullmatch(r'/(new)/saved/preroll/(motion_[0-9]{13}[.]mp4)',path)
  if m:return self.archive(m.group(1),'/saved/preroll/'+m.group(2),head)
  m=re.fullmatch(r'/(new)/saved/complete/(motion_[0-9]{13}[.]mp4)',path)
  if m:return self.archive(m.group(1),'/saved/complete/'+m.group(2),head)
  m=re.fullmatch(r'/(new)/saved/(clip|snap)/([A-Za-z0-9._-]{1,220})',path)
  if m:return self.archive(m.group(1),'/saved/'+m.group(2)+'/'+urllib.parse.quote(m.group(3)),head)
  m=re.fullmatch(r'/(new)/(events\.json|latest\.jpg|clip|save|delete)',path)
  if m:return self.local_recorder(m.group(1),'/'+m.group(2),head)
  parts=path.strip('/').split('/')
  if len(parts)!=2 or parts[0] not in UP or parts[1] not in ('health.json','live.mjpg','camera-controls'): return self.empty(404)
  cam,kind=parts
  if cam=='new' and kind=='live.mjpg' and Path('/home/jespern/c720p-home-hub/state/s9-native-security-active.flag').is_file():
   url='http://127.0.0.1:18808/mjpeg'
  else:url=f'http://127.0.0.1:{UP[cam]}/{kind}'
  try:
   r=urllib.request.urlopen(url,timeout=4 if kind=='health.json' else 8)
   ct=r.headers.get('Content-Type') or ('application/json' if kind=='health.json' else 'multipart/x-mixed-replace')
   self.send_response(200);self.cors();self.send_header('Content-Type',ct);self.send_header('Cache-Control','no-store, no-cache, must-revalidate');self.send_header('Connection','close')
   if kind=='health.json':
    data=r.read(512000);self.send_header('Content-Length',str(len(data)));self.end_headers();
    if not head:self.wfile.write(data)
   else:
    self.end_headers()
    if head:return
    while True:
     # Small live-stream chunks prevent several MJPEG frames being batched
     # into one large write, which otherwise looks jerky in browsers.
     b=r.read(8192)
     if not b:break
     self.wfile.write(b);self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError): pass
  except Exception:
   try:
    data=b'{"ok":false,"error":"upstream_unavailable"}';self.send_response(502);self.cors();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();
    if not head:self.wfile.write(data)
   except:pass
if __name__=='__main__':
 s=ThreadingHTTPServer(('0.0.0.0',PORT),H);s.daemon_threads=True;s.serve_forever()
