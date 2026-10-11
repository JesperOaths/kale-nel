#!/usr/bin/env python3
"""Guarded repair of native camera-controls paths on the authenticated LAN relay.

Only GET /new/camera-controls and explicitly user-initiated POST
/new/camera-control are forwarded from 8794 to the existing 8795 native
Camera2 control handler. Existing native 8795 input validation remains active;
no camera command is issued by this installer. Source backup, restart, HTTP
checks, rollback. No originals, APK, detector or archive mutations.
"""
from datetime import datetime,timezone
from pathlib import Path
import hashlib,json,os,py_compile,re,stat,subprocess,tempfile,time,urllib.request
SOURCE=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-native-controls-v18")
UNIT="c720p-lan-camera-relay.service"
MARKER="SECURITY_NATIVE_CAMERA2_RELAY_V18"
GET_ANCHOR=("  m=re.fullmatch(r'/(new)/api/saved',path)\n"
            "  if m:return self.archive(m.group(1),'/api/saved',head)")
GET_ADD=(
 "  # SECURITY_NATIVE_CAMERA2_RELAY_V18: authenticated GET, read-only metadata\n"
 "  m=re.fullmatch(r'/(new)/camera-controls',path)\n"
 "  if m:return self.archive(m.group(1),'/camera-controls',head)\n")
POST_ANCHOR=("  parts=path.strip('/').split('/')\n"
             "  if len(parts)!=2 or parts[0] not in UP or parts[1]!='camera-control': return self.empty(404)")
POST_ADD=(
 "  # Native Camera2 controls: only from a deliberate UI selection, never automatic\n"
 "  if path=='/new/camera-control':\n"
 "   if not self.origin_ok() or self.headers.get('X-S9-Camera-Control-Intent')!='explicit-user-selection-v1':return self.empty(403)\n"
 "   try:\n"
 "    n=int(self.headers.get('Content-Length','0'))\n"
 "    if not 2<=n<=256 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(415)\n"
 "    body=self.rfile.read(n);d=json.loads(body)\n"
 "    if not isinstance(d,dict) or set(d)!={'key','value'} or not isinstance(d['key'],str) or not isinstance(d['value'],str):return self.empty(400)\n"
 "    if d['key'] not in ('zoom','exposure_ev','torch','focus','recording_rotation','garden_zone'):return self.empty(400)\n"
 "    header={'Content-Type':'application/json','X-S9-Camera-Control-Intent':'explicit-user-selection-v1'}\n"
 "    if self.headers.get('Origin'):header['Origin']=self.headers['Origin']\n"
 "    req=urllib.request.Request('http://127.0.0.1:8795/new/camera-control',data=body,headers=header,method='POST')\n"
 "    try:r=urllib.request.urlopen(req,timeout=12)\n"
 "    except urllib.error.HTTPError as e:r=e\n"
 "    data=r.read(8192);self.send_response(r.status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return\n"
 "   except Exception:return self.empty(502)\n")
CORS_ANCHOR="Authorization,Content-Type,X-C720P-Relay-Token"
def sha(b):return hashlib.sha256(b).hexdigest()
def get(port,route):
 with urllib.request.urlopen(f"http://127.0.0.1:{port}{route}",timeout=12) as r:
  b=r.read(300000)
  if r.status!=200:raise RuntimeError("camera_controls_http")
 d=json.loads(b)
 if d.get("ok") is not True or not isinstance(d.get("controls"),dict) or "zoom" not in d["controls"]:
  raise RuntimeError("camera_controls_payload")
 return d
def saved():
 with urllib.request.urlopen("http://127.0.0.1:8794/new/api/saved",timeout=12) as r:d=json.load(r)
 if d.get("archive_mode")!="S9-microSD-only" or not isinstance(d.get("events"),list):
  raise RuntimeError("archive_unavailable")
 return len(d["events"])
def run(*args):
 p=subprocess.run(["systemctl","--user",*args,UNIT],capture_output=True,text=True,timeout=22)
 if p.returncode:raise RuntimeError("relay_service_failed")
 return p.stdout.strip()
def atomic(payload,st):
 fd,tmp=tempfile.mkstemp(prefix=".s9-camera-controls-v18-",dir=SOURCE.parent)
 try:
  with os.fdopen(fd,"wb") as out:out.write(payload);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode))
  try:os.chown(tmp,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(tmp,SOURCE)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 if not SOURCE.is_file() or SOURCE.is_symlink():raise RuntimeError("relay_source_unavailable")
 if run("is-active")!="active":raise RuntimeError("relay_inactive")
 original=SOURCE.read_bytes();stat_original=SOURCE.stat();text=original.decode()
 if "SECURITY_HISTORICAL_DRIVE_READONLY_RELAY_V16" not in text or "SECURITY_NATIVE_READONLY_TELEMETRY_V14" not in text:
  raise RuntimeError("existing_security_routes_not_installed")
 n=saved();get(8795,"/new/camera-controls")
 if MARKER in text:
  get(8794,"/new/camera-controls")
  print("S9_CAMERA_CONTROLS_RELAY_V18_VERIFIED "+json.dumps({"already_installed":True,"microSD_count":n}),flush=True)
  return
 for a in (GET_ANCHOR,POST_ANCHOR,CORS_ANCHOR):
  if text.count(a)!=1:raise RuntimeError("unexpected_control_route_source")
 patch=text.replace(GET_ANCHOR,GET_ADD+GET_ANCHOR,1).replace(POST_ANCHOR,POST_ADD+POST_ANCHOR,1)
 patch=patch.replace(CORS_ANCHOR,CORS_ANCHOR+",X-S9-Camera-Control-Intent",1)
 revised=patch.encode()
 with tempfile.TemporaryDirectory(prefix="s9-ctl-compile-") as td:
  p=Path(td)/"relay.py";p.write_bytes(revised);py_compile.compile(str(p),doraise=True)
 BACKUP.mkdir(parents=True,exist_ok=True);os.chmod(BACKUP,0o700)
 backup=BACKUP/("before-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 backup.write_bytes(original);os.chmod(backup,0o600)
 if backup.read_bytes()!=original or SOURCE.read_bytes()!=original:raise RuntimeError("backup_or_concurrent_relay_edit")
 installed=False
 try:
  atomic(revised,stat_original);installed=True;run("restart")
  for i in range(17):
   try:
    d=get(8794,"/new/camera-controls")
    now=saved()
    if run("is-active")=="active" and now>=n:
     print("S9_CAMERA_CONTROLS_RELAY_V18_VERIFIED "+json.dumps({
      "already_installed":False,"native_controls":sorted(d["controls"]),
      "microSD_count":now,"backup":str(backup),
      "before_sha256":sha(original),"installed_sha256":sha(revised),
      "no_commands_sent":True,"service":"active"}),flush=True)
     return
   except Exception:time.sleep(1)
  raise RuntimeError("control_route_validation_failed")
 except BaseException:
  if installed:
   try:
    atomic(original,stat_original);run("restart")
    saved();print("S9_CAMERA_CONTROLS_RELAY_V18_ROLLED_BACK",flush=True)
   except Exception:print("S9_CAMERA_CONTROLS_RELAY_V18_MANUAL_REPAIR_REQUIRED",flush=True)
  raise
if __name__=="__main__":main()
