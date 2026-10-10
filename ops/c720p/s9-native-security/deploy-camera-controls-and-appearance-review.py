#!/usr/bin/env python3
"""Atomic-ish, reversible C720P native Camera2+visitor review relay deployment.

Run only AFTER guarded signed APK installation has passed. Never alters SD
recordings, cloud media, Home LIVE stream, or the protected release directory.
"""
import argparse,datetime,importlib.util,json,os,pathlib,shutil,subprocess,time,urllib.error,urllib.request

ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
BIN=ROOT/"bin"
WWW=pathlib.Path("/opt/homeassistant/config/www")
SURVEILLANCE=WWW/"c720p-surveillance.html"
CLIPS=WWW/"frontyard-security-new/clips.html"
BACKUP=ROOT/"backups/s9-native-camera-controls-and-outfits"
PROXY="c720p-drive-security-archive.service"

def get(path,base="http://127.0.0.1:8795"):
 with urllib.request.urlopen(base+path,timeout=12) as res:
  if res.status!=200:raise RuntimeError("http_code")
  return json.loads(res.read(150000))

def service(*args):
 return subprocess.run(["systemctl","--user",*args],capture_output=True,text=True,timeout=65,check=True).stdout.strip()

def mp4_probe(name):
 req=urllib.request.Request("http://127.0.0.1:8795/new/saved/clip/"+name,
    headers={"Range":"bytes=0-1023"})
 with urllib.request.urlopen(req,timeout=23) as r:
  if r.status!=206 or len(r.read())!=1024:raise RuntimeError("sd_MP4_byte_range_failed")

def post_control(key,value,intent):
 body=json.dumps({"key":key,"value":value},separators=(",",":")).encode()
 req=urllib.request.Request("http://127.0.0.1:8795/new/camera-control",
   method="POST",data=body,headers={"Content-Type":"application/json",
    "X-S9-Camera-Control-Intent":intent})
 try:
  with urllib.request.urlopen(req,timeout=12) as res:
   return res.status,json.loads(res.read(10000))
 except urllib.error.HTTPError as e:return e.code,{"ok":False}

def load(path):
 spec=importlib.util.spec_from_file_location("s9staged_"+path.stem.replace("-","_"),path)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 return m

def copy(src,dest):
 dest.parent.mkdir(parents=True,exist_ok=True)
 tmp=dest.with_name(dest.name+".camera-controls-new")
 shutil.copy2(src,tmp)
 os.replace(tmp,dest)

def deploy(stage):
 mappings={
  BIN/"s9_native_camera_controls.py":stage/"s9-person-ml-v1/s9_native_camera_controls.py",
  BIN/"s9_sd_proxy_extension.py":stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
  BIN/"s9_drive_visitor_review.py":stage/"s9-person-ml-v1/s9_drive_visitor_review.py",
  BIN/"s9_appearance_review.py":stage/"s9-native-security/s9_appearance_review.py",
  BIN/"s9-drive-person-catalog.py":stage/"s9-native-security/drive-person-batch-catalog.py"}
 tests=(stage/"s9-native-security/test-native-camera-controls.py",
        stage/"s9-native-security/test-appearance-review.py",
        stage/"s9-native-security/test-drive-person-batch-catalog.py",
        stage/"s9-native-security/test-drive-visitor-review.py")
 cp=load(stage/"s9-native-security/patch-native-camera-controls-ui.py")
 vp=load(stage/"s9-native-security/patch-drive-visitor-review-ui.py")
 for f in [*mappings.values(),*tests]:
  if not f.is_file():raise RuntimeError("staging_incomplete_"+f.name)
 # Runtime regression tests inspect the actual Android Java sources. The
 # separately staged relay bundle does not itself contain the Android tree.
 # Copy ONLY from the coherently compiled/signed local build: never mix APKs.
 build=ROOT/"build/s9-native-security"
 stamps=[build/".source-commit",build/".compiled-commit",
         build/"s9-native-security.apk.source-commit"]
 if any(not f.is_file() for f in stamps):raise RuntimeError("APK_build_source_revision_missing")
 revisions=[f.read_text().strip() for f in stamps]
 if len(set(revisions))!=1 or not __import__("re").fullmatch(r"[0-9a-f]{40}",revisions[0]):
  raise RuntimeError("APK_signed_compiled_source_revision_mismatch")
 java_dst=stage/"s9-native-security/src/nl/kalenel/s9security"
 java_src=build/"src/nl/kalenel/s9security"
 java_dst.mkdir(parents=True,exist_ok=True)
 for filename in ("CameraService.java","CameraControls.java","MotionGrid.java"):
  original=java_src/filename
  if not original.is_file():raise RuntimeError("compiled_camera_java_missing_"+filename)
  staged=java_dst/filename
  if staged.exists() and staged.read_bytes()!=original.read_bytes():
   raise RuntimeError("staged_java_does_not_match_signed_APK_"+filename)
  if not staged.exists():shutil.copy2(original,staged)
 for t in tests:
  subprocess.run(["python3",str(t)],check=True,capture_output=True,text=True,timeout=50,
     env={**os.environ,"PYTHONPATH":str(stage/"s9-native-security")})
 native=get("/controls","http://127.0.0.1:18808")
 if not native.get("ok") or "zoom" not in native.get("controls",{}):
  raise RuntimeError("guarded_Camera2_APK_not_installed_or_no_controls")
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as r:phone=json.load(r)
 if not phone.get("ok") or phone.get("mode")!="watching" or phone.get("temperature_c",99)>38:
  raise RuntimeError("camera_not_safe_to_modify_proxy")
 saved=get("/new/api/saved")
 oldn=len(saved.get("events",[]))
 if saved.get("archive_mode")!="S9-microSD-only" or oldn<20:
  raise RuntimeError("SD_index_missing")
 clip=next((x.get("remote_name") for x in saved["events"] if str(x.get("remote_name","")).endswith(".mp4")),None)
 if not clip:raise RuntimeError("no_MP4_source")
 mp4_probe(clip)
 review=get("/new/api/drive-person-review")
 old_classified=review.get("processed",0)
 targets={**mappings,SURVEILLANCE:None,CLIPS:None}
 old_content={SURVEILLANCE:SURVEILLANCE.read_text(),CLIPS:CLIPS.read_text()}
 patch_content={SURVEILLANCE:cp.patch(old_content[SURVEILLANCE]),
                CLIPS:vp.patch(old_content[CLIPS])}
 if "S9_NATIVE_CAMERA2_SECURITY_CONTROLS_V1" not in patch_content[SURVEILLANCE]:
  raise RuntimeError("signed_camera_control_UI_missing")
 if "Possible repeat outfit" not in patch_content[CLIPS]:
  raise RuntimeError("outfit_review_section_missing")
 # Timer must be between batches before source code can safely change.
 for i in range(15):
  p=subprocess.run(["systemctl","--user","is-active","c720p-s9-drive-person-catalog.service"],capture_output=True,text=True,timeout=8)
  if p.stdout.strip()!="active":break
  time.sleep(3)
 else:raise RuntimeError("historic_drive_batch_currently_active")
 stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 base=BACKUP/stamp;base.mkdir(parents=True,exist_ok=False)
 original={}
 for i,dest in enumerate(targets):
  if dest.is_file():
   original[dest]=base/(str(i)+"-"+dest.name)
   shutil.copy2(dest,original[dest])
  else:original[dest]=None
 changed=[]
 try:
  for dst,src in mappings.items():copy(src,dst);changed.append(dst)
  for dst,body in patch_content.items():
   if body==old_content[dst]:continue
   tmp=base/(dst.name+".html")
   tmp.write_text(body)
   os.chmod(tmp,dst.stat().st_mode & 0o777)
   copy(tmp,dst)
   changed.append(dst)
  service("restart",PROXY)
  for i in range(7):
   try:
    opts=get("/new/camera-controls")
    assert opts.get("ok") and "zoom" in opts.get("controls",{})
    break
   except Exception:
    if i==6:raise
    time.sleep(2)
  current=str(opts["controls"]["zoom"]["value"])
  code,reply=post_control("zoom",current,"bad-intent")
  if code!=403:raise RuntimeError("unauthorized_native_control_accepted")
  code,reply=post_control("zoom",current,"explicit-user-selection-v1")
  if code!=200 or not reply.get("ok") or reply.get("value")!=current:
   raise RuntimeError("native_zoom_noop_set_failed")
  now=get("/new/api/saved")
  if len(now.get("events",[]))<oldn:raise RuntimeError("microSD_video_rows_lost")
  mp4_probe(clip)
  people=get("/new/api/drive-person-review")
  if people.get("processed",0)<old_classified:
   raise RuntimeError("Drive_classification_catalog_regressed")
  if people.get("automatic_identity")!="not_available_outfit_similarity_review_only":
   raise RuntimeError("visitor_identity_qualifier_lost")
  with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as r:health=json.load(r)
  if health.get("mode")!="watching" or not health.get("ok"):
   raise RuntimeError("Camera2_health_regressed")
  print("S9_NATIVE_CONTROLS_AND_VISITOR_REVIEW_DEPLOY_PASS",json.dumps({
   "camera_controls":sorted(opts["controls"]),"native_noop_zoom":current,
   "SD_videos":len(now["events"]),"Drive_classified":people["processed"],
   "phone_mode":health["mode"],"temperature":health.get("temperature_c"),
   "original_4K_recordings_untouched":True,
   "identity":"similar_outfit_candidates_only_manual_persistent_links",
   "rollback":str(base)}),flush=True)
 except Exception as e:
  print("S9_CONTROLS_RELAY_AUTO_ROLLBACK",type(e).__name__,str(e)[:220],flush=True)
  for dst in reversed(changed):
   if original[dst] is None:dst.unlink(missing_ok=True)
   else:copy(original[dst],dst)
  try:service("restart",PROXY)
  except Exception as error:print("S9_PROXY_ROLLBACK_RESTART_FAILED",type(error).__name__,flush=True)
  raise

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--stage",type=pathlib.Path,required=True)
 deploy(p.parse_args().stage.resolve())
