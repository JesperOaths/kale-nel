"""Private, non-biometric clothing appearance comparisons for old Drive security clips.

No face pixels, face recognition, facial landmarks, gait or legal identity.
The feature is an evidence-based REVIEW SUGGESTION, not verified person re-ID.
"""
import datetime
import math
import re
import statistics

VECTOR_N=48
MIN_FRAMES=2
MAX_HOURS=24*30

def describe(raw,evidence,width=320,height=240):
 """48-bin upper/lower torso RGB histogram, aggregated across single-person samples."""
 import numpy as np
 from PIL import Image
 frame_bytes=width*height*3
 if len(raw)%frame_bytes:raise ValueError("invalid_RGB_input")
 histograms=[]
 qualities=[]
 for i,frame in enumerate(evidence):
  if i>=len(raw)//frame_bytes:break
  boxes=frame.get("single_person_box")
  if not isinstance(boxes,list) or len(boxes)!=4:continue
  if frame.get("persons_050")!=1 or frame.get("person_score",0)<.50:continue
  top,left,bottom,right=[max(0,min(1,float(x))) for x in boxes]
  h=bottom-top;w=right-left
  if h<.25 or w<.085:continue
  x0=max(0,int(width*(left+.18*w)));x1=min(width,int(width*(right-.18*w)))
  y1=max(0,int(height*(top+.17*h)));y2=min(height,int(height*(top+.54*h)))
  y3=max(y2+1,min(height,int(height*(top+.55*h))))
  y4=min(height,int(height*(top+.91*h)))
  if x1-x0<8 or y2-y1<8 or y4-y3<8:continue
  sample=raw[i*frame_bytes:(i+1)*frame_bytes]
  image=np.frombuffer(sample,dtype=np.uint8).reshape(height,width,3)
  halves=(image[y1:y2,x0:x1,:],image[y3:y4,x0:x1,:])
  if min(part.size for part in halves)<300:continue
  # Reject dark, blown out or near-uniform crops; these are not informative
  # clothing descriptors and would generate spurious repeated-person matches.
  pixels=np.concatenate([p.reshape(-1,3) for p in halves],axis=0)
  brightness=float(np.median(pixels))
  contrast=float(np.std(pixels))
  if brightness<38 or brightness>225 or contrast<18:continue
  vector=[]
  for part in halves:
   for channel in range(3):
    bins,_=np.histogram(part[:,:,channel],bins=8,range=(0,256))
    bins=bins.astype(np.float64)
    vector.extend((bins/max(1,bins.sum())).tolist())
  if len(vector)!=VECTOR_N:raise RuntimeError("appearance_descriptor_shape")
  histograms.append(vector)
  qualities.append({"brightness":brightness,"contrast":contrast})
 if len(histograms)<MIN_FRAMES:
  return {"quality":"insufficient_clear_single_person_samples",
          "sample_frames":len(histograms),"descriptor":None,
          "identity_status":"not_evaluated"}
 arr=np.asarray(histograms)
 prototype=np.median(arr,axis=0)
 for j in range(6):
  v=prototype[j*8:(j+1)*8]
  prototype[j*8:(j+1)*8]=v/max(v.sum(),1e-8)
 return {"quality":"clothing_color_candidate",
         "sample_frames":len(histograms),
         "descriptor":[round(float(a),5) for a in prototype],
         "median_brightness":round(float(statistics.median(q["brightness"] for q in qualities)),1),
         "identity_status":"unverified_appearance_only"}

def similarity(a,b):
 """Symmetric histogram intersection. One means identical clothing colors."""
 if not isinstance(a,list) or not isinstance(b,list) or len(a)!=VECTOR_N or len(b)!=VECTOR_N:
  return None
 if any(not isinstance(x,(int,float)) or not math.isfinite(x) or x<0 or x>1 for x in a+b):
  return None
 return round(sum(min(x,y) for x,y in zip(a,b))/6,4)

def camera_time(name):
 match=re.search(r"(?:NEW|S3)_(20\d{12})",str(name))
 if not match:return None
 try:
  return datetime.datetime.strptime(match.group(1),"%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
 except ValueError:return None

def review_suggestions(target,rows,limit=3):
 """Best clothing-only comparables. Never emits an identity or assigns a visitor ID."""
 descriptor=target.get("appearance_descriptor")
 if target.get("category") not in ("single_person_event_candidate","possible_person_needs_review"):
  return []
 if target.get("appearance_quality")!="clothing_color_candidate":return []
 origin=camera_time(target.get("remote_name"))
 if origin is None:return []
 possible=[]
 for other in rows:
  if other.get("clip_id")==target.get("clip_id"):continue
  if other.get("camera")!=target.get("camera"):continue
  if other.get("category") not in ("single_person_event_candidate","possible_person_needs_review"):
   continue
  if other.get("appearance_quality")!="clothing_color_candidate":continue
  when=camera_time(other.get("remote_name"))
  if when is None:continue
  age=abs((origin-when).total_seconds())/3600
  if age>MAX_HOURS:continue
  score=similarity(descriptor,other.get("appearance_descriptor"))
  if score is None or score<.88:continue
  possible.append({"clip_id":other["clip_id"],"appearance_score":score,
                   "same_day":origin.date()==when.date(),
                   "source":"clothing_color_similarity_only",
                   "person_identity_verified":False})
 possible.sort(key=lambda x:(x["appearance_score"],x["same_day"]),reverse=True)
 return possible[:max(0,min(5,int(limit)))]
