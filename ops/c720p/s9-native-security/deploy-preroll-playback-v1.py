#!/usr/bin/env python3
"""Guarded S9 original+preroll streaming: modify only C720P proxy route and V8 UI.
No media, camera, or review-state changes; preserve installed proxy customizations.
"""
import datetime,json,os,pathlib,py_compile,re,shutil,subprocess,urllib.request
P=pathlib.Path("/home/jespern/c720p-home-hub/bin/s9_sd_proxy_extension.py")
PAGE=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/security-review-v8.html")
SOURCE=pathlib.Path("/home/jespern/c720p-home-hub/build/security-v8/security-review-v8.html")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/s9-preroll-playback")
SERVICE="c720p-drive-security-archive.service"
MARK="Optional on-phone H.264 RAM-ring preroll"
ROUTE=r'''  # Optional on-phone H.264 RAM-ring preroll, bound to a verified primary
  # recording and never exposed by arbitrary filenames.
  preroll=re.fullmatch(r"/new/saved/preroll/(motion_[0-9]{13}[.]mp4)",path)
  if preroll:
   original_name=preroll.group(1);item=data.get(original_name)
   if not item:
    self.js(404,{"ok":False,"error":"original_not_indexed"});return
   companion=original_name+".preroll.mp4"
   try:
    request=urllib.request.Request("http://127.0.0.1:18808/clip/"+companion,method="HEAD")
    with urllib.request.urlopen(request,timeout=8) as response:
     size=int(response.headers.get("Content-Length","0"))
    if not 10000<size<60000000:raise ValueError("preroll_size_invalid")
    return play_sd(self,companion,{**item,"size":size})
   except (ValueError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError):
    self.js(404,{"ok":False,"error":"no_verified_preroll_for_clip"});return
'''
ANCHOR='  match=re.fullmatch(r"/new/saved/clip/([A-Za-z0-9._-]+[.]mp4)",path)'
def run(*args):
 return subprocess.run(args,capture_output=True,text=True,timeout=40,check=True).stdout.strip()
def http(url):
 try:
  with urllib.request.urlopen(url,timeout=15) as r:return r.status,r.read(1000000)
 except urllib.error.HTTPError as e:return e.code,e.read(15000)
def main():
 if not P.is_file() or not PAGE.is_file() or not SOURCE.is_file():
  raise RuntimeError("expected_private_service_or_v8_template_missing")
 original=P.read_bytes();index=PAGE.read_bytes();src=original.decode()
 if MARK not in src:
  if src.count(ANCHOR)!=1:raise RuntimeError("proxy_route_unrecognized")
  replacement=src.replace(ANCHOR,ROUTE+ANCHOR)
 else:replacement=src
 updated=SOURCE.read_text()
 if 'preFound' not in updated or "new/saved/preroll" not in updated:
  raise RuntimeError("unverified_preroll_webpage")
 if 's9v8-review-script' not in updated or len(updated)<15000:
  raise RuntimeError("invalid_updated_browser")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/stamp;backup.mkdir(parents=True,mode=0o700)
 (backup/P.name).write_bytes(original);(backup/PAGE.name).write_bytes(index)
 changed=False
 try:
  stage=P.with_name(P.name+".preroll-v1-stage")
  stage.write_text(replacement);stage.chmod(P.stat().st_mode&0o777)
  py_compile.compile(str(stage),cfile="/tmp/s9-preroll-relay-compile.pyc",doraise=True)
  os.replace(stage,P);changed=True
  temp=PAGE.with_name(PAGE.name+".preroll-v1-stage")
  temp.write_text(updated);temp.chmod(PAGE.stat().st_mode&0o777)
  os.replace(temp,PAGE)
  run("systemctl","--user","restart",SERVICE)
  healthy,_=http("http://127.0.0.1:8795/new/api/saved")
  if healthy!=200:raise RuntimeError("archive_not_online")
  with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as r:
   saved=json.load(r)
  if len(saved.get("events",[]))<273:raise RuntimeError("archive_clips_missing")
  today,blob=http("http://127.0.0.1:8123/local/frontyard-security-new/security-review-v8.html?mode=today")
  if today!=200 or b"preFound" not in blob:raise RuntimeError("new_ui_not_loaded")
  clips=[x.get("clip_no") for x in saved["events"] if re.fullmatch(r"motion_[0-9]{13}[.]mp4",str(x.get("clip_no","")))]
  if not clips:raise RuntimeError("no_native_clip")
  url="http://127.0.0.1:8795/new/saved/preroll/"+clips[-1]
  status,_=http(url)
  if status not in (200,404):raise RuntimeError("preroll_route_server_error_"+str(status))
  print("S9_PREROLL_PLAYBACK_ROUTING_DEPLOYED",json.dumps({"backup":str(backup),
    "archive_count":len(saved["events"]),"new_route_status":status,
    "preroll_sample_not_necessarily_present":status==404,"page_http":today,
    "live_camera_unmodified":True,"original_mp4s_unmodified":True},sort_keys=True))
 except Exception:
  P.write_bytes(original);PAGE.write_bytes(index)
  try:run("systemctl","--user","restart",SERVICE)
  except Exception:pass
  raise
if __name__=="__main__":main()
