#!/usr/bin/env python3
"""Expose only Content-Range to ALREADY AUTHORIZED C720P browser origins.

S9+ 4K originals, migrated MP4s, review decisions, local Save/Delete, port
routing, CORS allowlists and authentication are unchanged. A source hash guard,
rollback and one short authenticated Chromium proof protect the 8794 relay.
"""
import argparse,datetime as dt,hashlib,json,os,py_compile,stat,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
import importlib.util

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
OLD_SHA="0d6f3cf03a8db1c5d470180e0e83a372c44e7a7c183644f7292049592af9cdba"
BACK=Path("/home/jespern/c720p-home-hub/backups/c720p-content-range-cors-v159")
SERVICE="c720p-lan-camera-relay.service"
CDP=Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
ANCHOR="if self.origin_ok():self.send_header('Access-Control-Allow-Origin',o);self.send_header('Vary','Origin')"
EXTRA=";self.send_header('Access-Control-Expose-Headers','Content-Range')"
PROOF="C720P_CONTENT_RANGE_CORS_V159_VERIFIED "
def sha(body):return hashlib.sha256(body).hexdigest()
def verified_file(path,limit):
 if path.is_symlink() or not path.is_file() or not 100<path.stat().st_size<limit:
  raise RuntimeError("untrusted_relay_file")
 return path.read_bytes()
def patch(raw,expected_sha):
 if sha(raw)!=expected_sha:raise RuntimeError("unexpected_newer_relay_source")
 s=raw.decode("utf8")
 if (s.count(ANCHOR)!=1 or "Access-Control-Expose-Headers" in s or
     "def cors(self):" not in s or
     "if not self.authorized(): return self.empty(401)" not in s):
  raise RuntimeError("authenticated_cors_source_contract_changed")
 newer=s.replace(ANCHOR,ANCHOR+EXTRA,1)
 if (newer.count("Access-Control-Expose-Headers")!=1 or
     newer.count("Access-Control-Allow-Origin")!=s.count("Access-Control-Allow-Origin") or
     newer.count("if self.origin_ok()")!=s.count("if self.origin_ok()") or
     newer.replace(EXTRA,"")!=s):
  raise RuntimeError("unexpected_extra_cors_patch")
 return newer.encode("utf8")
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=11) as r:
  if r.status!=200:raise RuntimeError("camera_unavailable")
  body=r.read(65537)
 if len(body)>65536:raise RuntimeError("camera_health_oversized")
 s=json.loads(body)
 if (s.get("ok") is not True or s.get("mode")!="watching"
     or s.get("continuous_4k_ready") is not True or
     s.get("native_4k_enabled") is not True or
     s.get("continuous_4k_dropped_output_frames")!=0 or
     s.get("continuous_4k_error") or
     type(s.get("temperature_c")) not in (int,float) or
     not 0<s["temperature_c"]<=39.5 or
     type(s.get("continuous_4k_buffered_ms")) is not int or
     s["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("capture_not_healthy_idle")
 return s
def unit(action):
 p=subprocess.run(["systemctl","--user",action,SERVICE],
     capture_output=True,text=True,timeout=30)
 if p.returncode:raise RuntimeError("relay_unit_"+action+"_failed")
 return p.stdout.strip()
def origin_header():
 # Unauthorized media remains unauthorized; only expose nonsecret response
 # header name to the ALREADY allowlisted HA origin on 8794.
 req=urllib.request.Request(
  "http://127.0.0.1:8794/new/api/c720p-migrated-clips",
  headers={"Origin":"http://localhost:8123"})
 try:r=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:r=e
 with r:
  headers=r.headers;status=r.status
 if status not in (401,403):raise RuntimeError("unauthorized_relay_http_contract_changed")
 if headers.get("Access-Control-Allow-Origin")!="http://localhost:8123":
  raise RuntimeError("existing_allowlisted_origin_not_preserved")
 if headers.get("Access-Control-Expose-Headers")!="Content-Range":
  raise RuntimeError("nonsecret_media_range_not_exposed")
 return True
def browser():
 if CDP.is_symlink() or not CDP.is_file():raise RuntimeError("verified_chromium_helper_missing")
 spec=importlib.util.spec_from_file_location("c720p_cors_probe_v159",CDP)
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 browser=helper.Socket(helper.get("json/version")["webSocketDebuggerUrl"])
 primary=next((x for x in helper.get("json/list") if x.get("type")=="page"
     and "c720p-hub" in x.get("url","")),None)
 target=None;page=None
 try:
  target=browser.call("Target.createTarget",{
    "url":"http://localhost:8123/local/c720p-surveillance.html",
    "background":True})["targetId"]
  for _ in range(55):
   tab=next((x for x in helper.get("json/list") if x.get("id")==target),None)
   if tab and tab.get("webSocketDebuggerUrl"):
    page=helper.Socket(tab["webSocketDebuggerUrl"]);page.sock.settimeout(80);break
   time.sleep(.2)
  if page is None:raise RuntimeError("browser_tab_not_ready")
  for _ in range(40):
   status=page.call("Runtime.evaluate",{"expression":"!!window.C720PSecureRelay?.fetch","returnByValue":True})
   if status.get("result",{}).get("value") is True:break
   time.sleep(.25)
  else:raise RuntimeError("browser_relay_not_authenticated")
  script=r"""(async()=>{
    const relay=window.C720PSecureRelay;
    const r=await relay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
    if(r.status!==200)return {ok:false};
    const d=await r.json(),rows=d.files;
    if(!d.ok||d.schema_version!=='c720p_s9_verified_import_v2'||!Array.isArray(rows)||
        rows.length!==d.total_imported||rows.length<6||rows.length>100)
      return {ok:false};
    let verified=0;
    const pattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$/;
    for(const item of rows){
      if(!item||!pattern.test(item.name)||item.name.includes('..')||
         !Number.isSafeInteger(item.bytes)||item.bytes<10000||item.bytes>943718400)
         return {ok:false};
      const url='/new/saved/c720p-migrated/clip/'+encodeURIComponent(item.name);
      const response=await relay.fetch(url,{headers:{Range:'bytes=0-1023'},cache:'no-store'});
      const correct=response.status===206 &&
        Number(response.headers.get('Content-Length')||0)===1024 &&
        response.headers.get('Content-Range')==='bytes 0-1023/'+String(item.bytes) &&
        (response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()==='video/mp4';
      try{await response.body?.cancel()}catch(_){}
      if(!correct)return {ok:false};
      verified++;
    }
    return {ok:true,verified_count:verified};
  })()"""
  raw=page.call("Runtime.evaluate",{"expression":script,
      "returnByValue":True,"awaitPromise":True})
  result=raw.get("result",{}).get("value")
  if (not isinstance(result,dict) or result.get("ok") is not True or
      type(result.get("verified_count")) is not int or result["verified_count"]<6):
   raise RuntimeError("browser_content_range_not_exposed")
  return result["verified_count"]
 finally:
  if page:
   try:page.close()
   except Exception:pass
  if primary:
   try:browser.call("Target.activateTarget",{"targetId":primary["id"]})
   except Exception:pass
  if target:
   try:browser.call("Target.closeTarget",{"targetId":target})
   except Exception:pass
  browser.close()
def atomic(path,data,mode):
 fd,temp=tempfile.mkstemp(prefix=".c720p-range-cors-v159-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as file:
   os.fchmod(file.fileno(),mode)
   file.write(data);file.flush();os.fsync(file.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def deploy(apply):
 old=verified_file(TARGET,150000)
 new=patch(old,OLD_SHA)
 mode=stat.S_IMODE(TARGET.stat().st_mode)
 if unit("is-active")!="active":raise RuntimeError("existing_relay_not_active")
 before=camera()
 with tempfile.TemporaryDirectory(prefix="cors-range-v159-") as tmp:
  source=Path(tmp)/"relay.py";source.write_bytes(new)
  py_compile.compile(str(source),doraise=True)
 if not apply:
  print("C720P_RANGE_CORS_V159_PREFLIGHT "+json.dumps({
    "known_live_relay_sha":True,"only_exposes_content_range":True,
    "source_schema_valid":True,"camera_temperature_c":before["temperature_c"],
    "media_modified":False,"reviews_modified":False,"camera_apk_modified":False},sort_keys=True),flush=True)
  return
 BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
 backup=BACK/("relay-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 backup.write_bytes(old);os.chmod(backup,0o600)
 if verified_file(backup,150000)!=old or verified_file(TARGET,150000)!=old:
  raise RuntimeError("backup_or_live_source_changed")
 installed=False
 try:
  atomic(TARGET,new,mode);installed=True
  unit("restart")
  if unit("is-active")!="active":raise RuntimeError("relay_not_active_after_patch")
  if verified_file(TARGET,150000)!=new:raise RuntimeError("relay_source_drift_after_patch")
  origin_header()
  count=browser()
  after=camera()
  print(PROOF+json.dumps({
    "all_browser_headers_visible":count>=6,
    "migrated_ranges_verified":count,
    "trusted_origin_unchanged":True,
    "relay_authorization_unchanged":True,
    "camera_temperature_after_c":after["temperature_c"],
    "camera_apk_modified":False,"videos_modified":False,
    "manual_reviews_modified":False,
    "private_source_backup":True,"local_c720p_mp4s_preserved":True},sort_keys=True),flush=True)
 except BaseException:
  if installed and TARGET.is_file() and sha(verified_file(TARGET,150000))==sha(new):
   atomic(TARGET,old,mode)
   unit("restart")
   print("C720P_RANGE_CORS_V159_ROLLED_BACK "+json.dumps({
     "known_source_restored":True,"originals_modified":False,
     "camera_apk_modified":False,"manual_reviews_modified":False}),flush=True)
  raise
if __name__=="__main__":
 ap=argparse.ArgumentParser();ap.add_argument("--apply",action="store_true")
 args=ap.parse_args()
 deploy(args.apply)
