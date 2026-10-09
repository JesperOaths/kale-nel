#!/usr/bin/env python3
"""Read-only S9 model evaluation on verified historical Drive security clips.

Streaming: rclone cat -> ffmpeg RGB frames in memory -> local TFLite CPU.
No MP4/JPEG files, biometric templates, faces, names, or Drive uploads.
Existing confidence is selection metadata, NOT human-confirmed ground truth.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import time

BASE=Path("/home/jespern/c720p-home-hub")
BUILD=BASE/"build/s9-detector-benchmark"
CONFIG=BASE/"config/drive-security-archive.json"
INDEX=BASE/"state/drive-security-archive.json"
RESULTS=BASE/"state/s9-legacy-person-corpus-metrics.json"
MODEL_SHA="e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13"
MODEL=BUILD/"assets/baseline.tflite"
FRAME_W,FRAME_H=320,240
PIXELS=FRAME_W*FRAME_H*3
NAME=re.compile(r"NEW_[A-Za-z0-9._-]{18,155}[.]mp4\Z")
MAX_MP4=85000000
MAX_FRAMES=20

def get_verified_high(max_clips,score_floor):
 doc=json.loads(INDEX.read_text())
 choices=[]
 for r in doc.get("items",[]):
  if not isinstance(r,dict) or r.get("camera")!="new" or r.get("state")!="verified":
   continue
  name=str(r.get("remote_name") or "")
  if not NAME.fullmatch(name):continue
  try:score=float(r.get("person_confidence") or 0)
  except (ValueError,TypeError):continue
  size=int(r.get("source_size") or r.get("size") or 0)
  if score<score_floor or not 100000<size<MAX_MP4:continue
  choices.append((score,name,r,size))
 # Day diversity prevents one burst/session from dominating the selection.
 choices.sort(key=lambda x:x[0],reverse=True)
 picked=[];days=collections.Counter()
 for score,name,row,size in choices:
  match=re.search(r"NEW_(\d{8})",name)
  day=match.group(1) if match else name[:15]
  if days[day]>=2:continue
  days[day]+=1
  picked.append((score,name,size,str(row.get("person_status") or "unreviewed")))
  if len(picked)>=max_clips:break
 return picked,len(choices)

def decode_frames(config,name,seconds):
 rclone=[config["rclone"],"--config",config["rclone_config"],"cat",
         config["remote"]+":"+name,
         "--drive-root-folder-id",str(config["folders"]["new"]["id"])]
 fps="1/2"
 ffmpeg=["ffmpeg","-nostdin","-hide_banner","-loglevel","error",
         "-threads","1","-i","pipe:0","-an","-sn",
         "-vf","fps="+fps+",scale="+str(FRAME_W)+":"+str(FRAME_H),
         "-frames:v",str(MAX_FRAMES),"-f","rawvideo",
         "-pix_fmt","rgb24","pipe:1"]
 old=subprocess.Popen(rclone,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 new=subprocess.Popen(ffmpeg,stdin=old.stdout,stdout=subprocess.PIPE,
                      stderr=subprocess.PIPE)
 old.stdout.close()
 try:
  raw,errors=new.communicate(timeout=seconds)
 except subprocess.TimeoutExpired:
  new.kill();new.communicate()
  raise RuntimeError("ffmpeg_timeout")
 finally:
  if old.poll() is None:old.terminate()
  try:old.wait(timeout=5)
  except subprocess.TimeoutExpired:old.kill();old.wait(timeout=5)
 if new.returncode!=0:
  raise RuntimeError("ffmpeg_"+str(new.returncode)+":"+errors.decode("utf8","replace")[-110:])
 if len(raw)%PIXELS!=0 or len(raw)>MAX_FRAMES*PIXELS:
  raise RuntimeError("invalid_rgb_frame_bytes")
 return raw

def active_camera():
 import urllib.request
 try:
  with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=7) as r:s=json.load(r)
 except Exception as e:raise RuntimeError("live_status_unavailable") from e
 if not s.get("ok") or s.get("mode")!="watching" or float(s.get("temperature_c",100))>=38:
  raise RuntimeError("camera_busy_or_hot")
 return s

def overlaps_same_object(a,b):
 # COCO boxes use [top,left,bottom,right], normalized 0..1.
 top=max(a[0],b[0]);left=max(a[1],b[1])
 bottom=min(a[2],b[2]);right=min(a[3],b[3])
 inter=max(0,bottom-top)*max(0,right-left)
 area_a=max(0,a[2]-a[0])*max(0,a[3]-a[1])
 area_b=max(0,b[2]-b[0])*max(0,b[3]-b[1])
 union=area_a+area_b-inter
 if union>0 and inter/union>=.45:return True
 cx_a=(a[1]+a[3])/2;cy_a=(a[0]+a[2])/2
 cx_b=(b[1]+b[3])/2;cy_b=(b[0]+b[2])/2
 return abs(cx_a-cx_b)<.05 and abs(cy_a-cy_b)<.05

def detect(raw,net,input_index,output,shape):
 import numpy as np
 from PIL import Image
 evidence=[]
 for i in range(len(raw)//PIXELS):
  segment=raw[i*PIXELS:(i+1)*PIXELS]
  img=Image.frombytes("RGB",(FRAME_W,FRAME_H),segment)
  rgb=np.asarray(img.resize((300,300),Image.Resampling.BILINEAR),dtype=np.uint8).reshape(shape)
  net.set_tensor(input_index,rgb)
  net.invoke()
  boxes,classes,scores,count=[net.get_tensor(output[n]) for n in (
   "TFLite_Detection_PostProcess",
   "TFLite_Detection_PostProcess:1",
   "TFLite_Detection_PostProcess:2",
   "TFLite_Detection_PostProcess:3")]
  n=min(10,max(0,int(round(float(count.flat[0])))))
  persons=[];vehicles=[];animals=[]
  for j in range(n):
   score=float(scores[0,j])
   if not .0<=score<=1.01:raise RuntimeError("invalid_classifier_score")
   cls=int(round(float(classes[0,j])))
   if score<.3:continue
   if cls==0:persons.append((score,[float(v) for v in boxes[0,j].tolist()]))
   elif cls in (1,2,3,5,6,7):vehicles.append(score)
   elif cls in (14,15,16,17,18,19,20,21,22,23):animals.append(score)
  # Suppress highly overlapping model boxes before counting distinct
  # simultaneously visible person candidates. Not identity tracking.
  strong=[]
  for candidate in sorted((p for p in persons if p[0]>=.50),reverse=True):
   if any(overlaps_same_object(candidate[1],existing[1]) for existing in strong):
    continue
   strong.append(candidate)
  person_max=max((p[0] for p in persons),default=0)
  evidence.append({"t_sec":2*i,"persons_050":len(strong),
    "person_score":round(person_max,4),
    "centers":[[round((p[1][1]+p[1][3])/2,3),
                round((p[1][0]+p[1][2])/2,3)] for p in strong],
    "vehicle_max":round(max(vehicles,default=0),4),
    "animal_max":round(max(animals,default=0),4)})
 return evidence

def categorize(evidence):
 pos=[x for x in evidence if x["persons_050"]>0]
 mid=[x for x in evidence if x["person_score"]>=.3]
 peak=max((x["person_score"] for x in evidence),default=0)
 simultaneous=max((x["persons_050"] for x in evidence),default=0)
 multiple_frames=sum(x["persons_050"]>=2 for x in evidence)
 if multiple_frames>=2:category="multiple_people_candidate"
 elif multiple_frames==1:category="possible_group_needs_frame_review"
 elif len(pos)>=2:category="single_person_event_candidate"
 elif len(pos)==1 or len(mid)>=2:category="possible_person_needs_review"
 else:category="unresolved_motion_or_non_person"
 # Never assert stationary/loitering or that two sightings are the same person.
 activity="not_measurable_without_track_and_human_review"
 if len(pos)>=3 and all(x["persons_050"]==1 for x in pos):
  points=[x["centers"][0] for x in pos]
  displacement=max(abs(points[i][0]-points[j][0]) for i in range(len(points)) for j in range(i+1,len(points)))
  displacement_y=max(abs(points[i][1]-points[j][1]) for i in range(len(points)) for j in range(i+1,len(points)))
  if displacement>=.28 or displacement_y>=.28:
   activity="bounding_box_position_changed_across_samples_not_identity"
 return {"event_category":category,"person_observed_frames_050":len(pos),
  "person_possible_frames_030":len(mid),"person_peak_score":round(peak,4),
  "max_simultaneous_detections":simultaneous,
  "frames_with_multiple_person_boxes":multiple_frames,"animal_score_peak":max((x["animal_max"] for x in evidence),default=0),
  "vehicle_score_peak":max((x["vehicle_max"] for x in evidence),default=0),
  "sampled_frames":len(evidence),"person_activity":activity,
  "identity":"not_evaluated","ground_truth":"not_independently_labeled"}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--max-clips",type=int,default=8)
 ap.add_argument("--score-floor",type=float,default=.94)
 args=ap.parse_args()
 if not 1<=args.max_clips<=10 or not .5<=args.score_floor<=1:
  raise SystemExit("bounded_options_required")
 assert MODEL.is_file() and hashlib.sha256(MODEL.read_bytes()).hexdigest()==MODEL_SHA
 cfg=json.loads(CONFIG.read_text())
 for key in ("rclone","rclone_config","remote","folders"):
  if key not in cfg:raise RuntimeError("old_archive_unconfigured")
 import numpy as np
 from ai_edge_litert.interpreter import Interpreter
 active_camera()
 net=Interpreter(model_path=str(MODEL),num_threads=1);net.allocate_tensors()
 inp=net.get_input_details()[0];shape=tuple(map(int,inp["shape"]))
 assert shape==(1,300,300,3) and inp["dtype"]==np.uint8
 outputs={d["name"]:d["index"] for d in net.get_output_details()}
 selected,available=get_verified_high(args.max_clips,args.score_floor)
 if not selected:raise RuntimeError("no_verified_high_person_source_clips")
 reports=[];failures=[]
 for index,(legacy_score,name,size,legacy_status) in enumerate(selected):
  if index%2==0:active_camera()
  start=time.monotonic()
  try:
   raw=decode_frames(cfg,name,95)
   evidence=detect(raw,net,inp["index"],outputs,shape)
   del raw
   if len(evidence)<2:raise RuntimeError("too_few_decoded_frames")
   report=categorize(evidence)
   # The clip filename is not included in the public-facing report; hash suffices.
   report.update({"name_sha256":hashlib.sha256(name.encode()).hexdigest(),
    "legacy_score_for_selection":round(legacy_score,4),
    "legacy_status":legacy_status,"clip_size_bytes":size,
    "elapsed_s":round(time.monotonic()-start,1),
    "sample_stride_s":2})
   reports.append(report)
   print("S9_LEGACY_CLIP_EVALUATED",len(reports),report["event_category"],report["person_observed_frames_050"],len(evidence),flush=True)
  except Exception as exc:
   failures.append({"name_sha256":hashlib.sha256(name.encode()).hexdigest(),"type":type(exc).__name__})
 after=active_camera()
 result={"version":"s9-legacy-eval-v1","source":"verified historical Google Drive security MP4 read-only",
  "eligible_candidates":available,"selected":len(selected),"processed":len(reports),
  "errors":failures,"storage":"metrics_only_private_C720P","cloud_upload":False,
  "video_or_images_saved":False,"model":"SSD_MobileNet_COCO_v1",
  "model_sha256":MODEL_SHA,"original_legacy_score_is_ground_truth":False,
  "identity_recognition":False,"camera_status_after":after.get("mode"),
  "categories":dict(collections.Counter(x["event_category"] for x in reports)),
  "clips":reports}
 RESULTS.parent.mkdir(parents=True,exist_ok=True)
 staging=RESULTS.with_suffix(".json.tmp")
 with staging.open("w") as f:
  json.dump(result,f,indent=2);f.flush();os.fsync(f.fileno())
 os.chmod(staging,0o600);os.replace(staging,RESULTS)
 print("S9_LEGACY_CORPUS_EVALUATION_PASS",json.dumps({
  "eligible":available,"tested":len(reports),"categories":result["categories"],
  "failures":failures,"camera_mode":after.get("mode"),
  "results_path":str(RESULTS)}))
 if not reports:raise RuntimeError("historical_no_clip_processed")
if __name__=="__main__":main()
