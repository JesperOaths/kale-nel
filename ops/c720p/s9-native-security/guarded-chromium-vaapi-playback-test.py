#!/usr/bin/env python3
"""Guarded kiosk-only hardware video decode test on existing Haswell i965 GPU.

Tries Chromium Linux VaapiVideoDecoder flags, independently benchmarks two
existing S9 recordings in a temporary CDP tab, keeps only if both yield
>=24 displayed FPS. Restores original kiosk script/restarts it otherwise.
Camera, recordings, other Home Assistant services are never changed.
"""
import datetime,json,os,pathlib,re,subprocess,time,urllib.request
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
KIOSK=ROOT/"bin/c720p-kiosk-zoomed.sh"
BACK=ROOT/"backups/kiosk-vaapi-s9-test"
UNIT="c720p-home-hub-kiosk.service"
PROBE=ROOT/"build/security-v8/security-v8-browser-fps-probe.py"
FEATURE="--enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL"
CLIPS=("motion_1791739041453.mp4","motion_1791740141770.mp4")
def cmd(*args,timeout=45):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=True)
 return r.stdout.strip()
def browser_ready(required=False):
 for i in range(45):
  try:
   with urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=3) as r:d=json.load(r)
   with urllib.request.urlopen("http://127.0.0.1:9222/json/list",timeout=3) as r:pages=json.load(r)
   if any(p.get("type")=="page" for p in pages):
    chrome=cmd("ps","-eo","args",timeout=8)
    flag=FEATURE in chrome
    if flag==required:return True
  except Exception:pass
  time.sleep(.55)
 return False
def restart():
 cmd("systemctl","--user","restart",UNIT,timeout=40)
def restore(old):
 KIOSK.write_bytes(old)
 restart()
 if not browser_ready(required=False):raise RuntimeError("original_kiosk_restoration_unverified")
def main():
 if not KIOSK.is_file() or not PROBE.is_file():raise RuntimeError("kiosk_or_benchmark_missing")
 old=KIOSK.read_bytes();text=old.decode()
 if FEATURE in text:raise RuntimeError("kiosk_already_has_vaapi_flags")
 pattern=r"(?m)^(?P<indent>[ \t]*)((?:--enable-gpu-rasterization))"
 matches=list(re.finditer(pattern,text))
 if len(matches)!=1:raise RuntimeError("kiosk_launch_anchor_changed")
 mark=matches[0];ins=mark.group("indent")+FEATURE+" \\\n"
 updated=text[:mark.start()]+ins+text[mark.start():]
 if updated.count(FEATURE)!=1:raise RuntimeError("invalid_updated_flags")
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/(datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".sh")
 backup.write_bytes(old)
 deployed=False;measure=[]
 try:
  stage=KIOSK.with_name(KIOSK.name+".vaapi-stage")
  stage.write_text(updated)
  stage.chmod(KIOSK.stat().st_mode&0o777)
  cmd("bash","-n",str(stage),timeout=10)
  os.replace(stage,KIOSK)
  restart()
  deployed=True
  if not browser_ready(required=True):raise RuntimeError("kiosk_with_vaapi_flags_unhealthy")
  for clip in CLIPS:
   env=dict(os.environ,S9_TEST_CLIP=clip,S9_TEST_PREFETCH="0",S9_TEST_STRIP_IFRAMES="0")
   result=subprocess.run(["python3",str(PROBE)],capture_output=True,text=True,timeout=85,env=env)
   raw=next((x.split("S9_REAL_KIOSK_4K_PLAYBACK_PERF ",1)[1]
     for x in result.stdout.splitlines() if "S9_REAL_KIOSK_4K_PLAYBACK_PERF " in x),None)
   if result.returncode or not raw:raise RuntimeError("browser_video_probe_failed_"+result.stderr[-120:])
   d=json.loads(raw)
   value={"clip":clip,"fps":round(float(d.get("observed_fps") or 0),2),
          "dropped":d.get("droppedFrames"),"width":d.get("videoWidth"),
          "height":d.get("videoHeight"),
          "stall_events":sum(t.get("event")=="waiting" for t in d.get("events",[]))}
   measure.append(value)
   print("C720P_VAAPI_CHROME_VIDEO_MEASURE",json.dumps(value,sort_keys=True),flush=True)
  if any(x["fps"]<24 or x["width"]!=640 or x["height"]!=360 for x in measure):
   raise RuntimeError("hardware_decode_failed_24fps_threshold")
  print("C720P_VAAPI_CHROMIUM_KEPT",json.dumps({"measurements":measure,
   "original_camera_untouched":True,"backup":str(backup)},sort_keys=True),flush=True)
 except Exception as e:
  if deployed or KIOSK.read_bytes()!=old:restore(old)
  print("C720P_VAAPI_CHROMIUM_NOT_ACCEPTED_ROLLED_BACK",json.dumps({
    "reason":str(e),"measurements":measure,"original_kiosk_restored":True,
    "camera_unchanged":True,"backup":str(backup)},sort_keys=True),flush=True)
if __name__=="__main__":main()
