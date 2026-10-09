#!/usr/bin/env python3
"""Reversible S9 source-image uplift 960x540 ->1920x1080 for GPU full/zoom person inference."""
import datetime,json,pathlib,shutil,sys,time,urllib.request
CFG=pathlib.Path("/home/jespern/c720p-security-camera-new/frontyard-security-config.json")
CAM="http://127.0.0.1:8793"
GPU="http://127.0.0.1:18799/status"
EDGE="http://127.0.0.1:18798/status"
def get(url):
 with urllib.request.urlopen(url,timeout=8) as r:return json.load(r)
def setkey(key,value):
 b=json.dumps({"key":key,"value":value}).encode()
 q=urllib.request.Request(CAM+"/camera-control",b,headers={"Content-Type":"application/json"})
 with urllib.request.urlopen(q,timeout=12) as r:return json.load(r)
def main():
 d=json.loads(CFG.read_text())
 old=get(CAM+"/camera-controls")["controls"]
 before=old["photo_size"]["value"],old["quality"]["value"]
 print("ORIGINAL_PHOTO",before,flush=True)
 if before[0]=="1920x1080" and before[1]=="75" and d.get("camera_photo_size")=="1920x1080":
  print("ALREADY_1080_PHOTOS_CONFIGURED");return
 assert before[0] in ("960x540","1920x1080"),"unexpected_camera_photo_source"
 baseline=get(GPU)
 assert baseline["ok"] and baseline["model_ready"] and baseline["backend"]=="gpu","GPU not healthy"
 edge=get(EDGE)
 assert edge["ok"] and edge["person_ml_healthy"],"S9 recorder bridge unhealthy"
 backup=CFG.with_name(CFG.name+".before-1080-photos-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
 shutil.copy2(CFG,backup)
 try:
  d["camera_photo_size"]="1920x1080"
  d["camera_quality"]=75
  temp=CFG.with_suffix(".json.camera1080")
  temp.write_text(json.dumps(d,indent=2)+"\n");temp.replace(CFG)
  print("SET_SIZE",setkey("photo_size","1920x1080"),flush=True)
  print("SET_QUALITY",setkey("quality","75"),flush=True)
  time.sleep(14)
  current=get(CAM+"/camera-controls")["controls"]
  now=get(GPU)
  e=get(EDGE)
  status=get(CAM+"/health.json")
  result={"photo":current["photo_size"]["value"],"quality":current["quality"]["value"],
    "new_inferences":now.get("inferences",0)-baseline.get("inferences",0),
    "snapshot_errors":now.get("snapshot_errors"),
    "model_errors":now.get("model_errors"),"inference_ms":now.get("inference_ms"),
    "temperature_c":now.get("temperature_c"),"camera_ok":status.get("camera_ok"),
    "edge_ok":e.get("ok"),"bridge_ok":e.get("person_ml_healthy")}
  print("UPLIFT_RESULT",result,flush=True)
  if (result["photo"]!="1920x1080" or result["quality"]!="75" or
   result["new_inferences"]<4 or
   result["snapshot_errors"]>baseline["snapshot_errors"]+1 or
   result["model_errors"]>baseline["model_errors"] or
   result["temperature_c"]>=39.5 or not result["camera_ok"] or not result["edge_ok"] or not result["bridge_ok"]):
   raise RuntimeError("uplift health regression")
  print("S9_1080_PERSON_ANALYSIS_INPUT_PASS",flush=True)
 except Exception:
  shutil.copy2(backup,CFG)
  try:setkey("photo_size",before[0]);setkey("quality",before[1])
  except Exception:pass
  print("CAMERA_PHOTO_SIZE_RESTORED",flush=True)
  raise
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("S9_PHOTO_UPLIFT_FAIL",type(e).__name__,str(e)[:140],file=sys.stderr)
  sys.exit(1)
