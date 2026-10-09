#!/usr/bin/env python3
"""S9+ live person/vehicle/animal sensor from existing native 640x480 JPEG.

Local CPU fallback on C720P: read the phone's already-captured /shot.jpg,
run SSD MobileNet, retain *only* aggregate scores/categories in private state.
No frame/video is saved, no camera controls, no Drive or identity recognition.
"""
import collections
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import sys
import time
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub")
MODEL=ROOT/"build/s9-detector-benchmark/assets/baseline.tflite"
STATE=ROOT/"state/s9-live-person-watch.json"
STATUS="http://127.0.0.1:18808/status"
JPEG="http://127.0.0.1:18808/shot.jpg"
MODEL_SHA="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
INTERVAL=4.0
MAX_EVENTS=48
stopping=False

def quit_signal(*args):
 global stopping
 stopping=True

def retrieve(url,limit=1500000):
 with urllib.request.urlopen(url,timeout=5) as response:
  if response.status!=200:raise OSError("not_http_200")
  blob=response.read(limit+1)
  if len(blob)>limit:raise ValueError("response_size_guard")
 return blob

def atomic_update(record):
 STATE.parent.mkdir(parents=True,exist_ok=True)
 temp=STATE.with_suffix(".json.tmp")
 with temp.open("w") as file:
  json.dump(record,file,separators=(",",":"),sort_keys=True)
  file.write("\n");file.flush();os.fsync(file.fileno())
 os.chmod(temp,0o600)
 os.replace(temp,STATE)

def categorize(frames,phone):
 latest=frames[-1] if frames else {}
 # Two comparable observations are required for a strong event;
 # one very high confidence result counts as a strong candidate, not truth.
 stable=sum(f.get("person_max",0)>=.48 for f in frames)>=2
 very_strong=any(f.get("person_max",0)>=.75 for f in frames)
 possible=sum(f.get("person_max",0)>=.30 for f in frames)>=1
 people=max((f.get("people_050",0) for f in frames),default=0)
 car=max((f.get("vehicle_max",0) for f in frames),default=0)
 animal=max((f.get("animal_max",0) for f in frames),default=0)
 if (stable or very_strong) and people>=2:kind="multiple_people_candidate"
 elif stable or very_strong:kind="person_likely_candidate"
 elif possible:kind="possible_person_needs_review"
 elif car>=.5:kind="vehicle_candidate"
 elif animal>=.5:kind="animal_candidate"
 elif phone.get("priority_motion"):kind="other_motion_detected"
 else:kind="no_object_detected"
 return {"kind":kind,"person_probability_not_calibrated":True,
  "person_score":round(max((f.get("person_max",0) for f in frames),default=0),4),
  "vehicle_score":round(car,4),"animal_score":round(animal,4),
  "simultaneous_people":people,
  "person_samples_above_048":sum(f.get("person_max",0)>=.48 for f in frames),
  "motion_priority":bool(phone.get("priority_motion")),
  "motion_events_since_service_start":int(phone.get("motion_events") or 0),
  "identity":"not_evaluated",
  "source":"S9+ Camera2 YUV native JPEG via ADB localhost"}

def infer(net,frame):
 from PIL import Image
 import numpy as np
 with Image.open(io.BytesIO(frame)) as im:
  if im.width<300 or im.height<200 or im.width>3840 or im.height>2160:
   raise ValueError("unexpected_native_preview_size")
  rgb=np.asarray(im.convert("RGB").resize((300,300),Image.Resampling.BILINEAR),
                 dtype=np.uint8).reshape((1,300,300,3))
 inp=net.get_input_details()[0]
 assert inp["dtype"]==np.uint8
 net.set_tensor(inp["index"],rgb);net.invoke()
 names={x["name"]:x["index"] for x in net.get_output_details()}
 boxes=net.get_tensor(names["TFLite_Detection_PostProcess"])
 classes=net.get_tensor(names["TFLite_Detection_PostProcess:1"])
 scores=net.get_tensor(names["TFLite_Detection_PostProcess:2"])
 num=net.get_tensor(names["TFLite_Detection_PostProcess:3"])
 n=min(10,max(0,int(round(float(num.flat[0])))))
 person=0.0;vehicle=0.0;animal=0.0;people=0
 for i in range(n):
  score=float(scores[0,i]);category=int(round(float(classes[0,i])))
  if not 0<=score<=1:continue
  if category==0:
   person=max(person,score)
   if score>=.50:people+=1
  elif category in (1,2,3,5,6,7):vehicle=max(vehicle,score)
  elif category in (14,15,16,17,18,19,20,21,22,23):animal=max(animal,score)
 return {"person_max":round(person,5),"vehicle_max":round(vehicle,5),
  "animal_max":round(animal,5),"people_050":people}

def main():
 import numpy as np
 from ai_edge_litert.interpreter import Interpreter
 if hashlib.sha256(MODEL.read_bytes()).hexdigest()!=MODEL_SHA:
  raise RuntimeError("model_hash_mismatch_refuse_live_watch")
 net=Interpreter(model_path=str(MODEL),num_threads=1);net.allocate_tensors()
 history=collections.deque(maxlen=3)
 episodes=collections.deque(maxlen=MAX_EVENTS)
 started=time.monotonic()
 samples=0;failures=0;last_kind="uninitialized"
 signal.signal(signal.SIGTERM,quit_signal)
 signal.signal(signal.SIGINT,quit_signal)
 while not stopping:
  begin=time.monotonic()
  timestamp=int(time.time()*1000)
  try:
   phone=json.loads(retrieve(STATUS,30000))
   if not phone.get("ok") or phone.get("mode") not in ("watching","recording"):
    raise RuntimeError("native_camera_not_healthy")
   if phone.get("snapshot_ready") is not True or float(phone.get("temperature_c",100))>=39:
    raise RuntimeError("no_fresh_jpeg_or_thermal_guard")
   if int(phone.get("snapshot_age_ms",50000))>5500:
    raise RuntimeError("camera_snapshot_stale")
   raw=retrieve(JPEG,1500000)
   if not raw.startswith(b"\xff\xd8\xff") or not raw.endswith(b"\xff\xd9"):
    raise RuntimeError("native_camera_invalid_jpeg")
   item=infer(net,raw);item["time_ms"]=timestamp;history.append(item);samples+=1
   current=categorize(list(history),phone)
   if current["kind"]!=last_kind and current["kind"] not in ("no_object_detected","other_motion_detected"):
    episodes.append({"time_ms":timestamp,"kind":current["kind"],
     "person_score":current["person_score"],"people":current["simultaneous_people"]})
   last_kind=current["kind"]
   report={"ok":True,"version":"s9-live-ssd-watch-v1","read_only":True,
     "production_camera_unchanged":True,"label_is_ground_truth":False,
     "model":"SSD_MobileNet_v1","model_sha256":MODEL_SHA,
     "last_sample_at_ms":timestamp,"sample_period_s":INTERVAL,
     "samples":samples,"failures":failures,"uptime_s":round(time.monotonic()-started,1),
     "camera_mode":phone.get("mode"),"camera_temperature_c":phone.get("temperature_c"),
     "motion_changed_ratio":phone.get("changed_ratio"),
     "motion_coherent_cells":phone.get("coherent_cells"),
     "status":current,"recent_candidate_transitions":list(episodes)}
  except Exception as exc:
   failures+=1
   history.clear();last_kind="sensor_unavailable"
   report={"ok":False,"version":"s9-live-ssd-watch-v1","read_only":True,
    "label_is_ground_truth":False,"last_sample_at_ms":timestamp,
    "samples":samples,"failures":failures,"error_code":type(exc).__name__,
    "status":{"kind":"sensor_unavailable","identity":"not_evaluated"},
    "recent_candidate_transitions":list(episodes)}
  atomic_update(report)
  deadline=begin+INTERVAL
  while not stopping and time.monotonic()<deadline:
   time.sleep(min(.25,max(0,deadline-time.monotonic())))
 print("S9_LIVE_PERSON_WATCH_STOPPED")
if __name__=="__main__":main()
