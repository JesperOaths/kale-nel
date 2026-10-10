"""Non-biometric, clothing-color evidence for possible repeat garden appearances.

Descriptors deliberately sample only central torso and lower-body patches of
strong, isolated, sufficiently lit full-body detections. Face/skin pixels,
facial landmarks, gait and identifiable embeddings are never extracted.
Similarity means 'possibly similar outfit', NOT the same person's identity.
"""
import datetime
import math
import re
import statistics

def descriptor(raw,evidence):
 import numpy as np
 W,H=320,240
 N=W*H*3
 vectors=[];positions=[]
 if len(raw)<N or len(raw)%N:raise ValueError("malformed_bounded_rgb_samples")
 for idx,ev in enumerate(evidence[:len(raw)//N]):
  box=ev.get("single_person_box")
  if not isinstance(box,list) or len(box)!=4 or ev.get("persons_050")!=1 or ev.get("person_score",0)<.65:continue
  t,l,b,r=map(float,box)
  if min(t,l,b,r)<0 or max(t,l,b,r)>1 or b-t<.28 or r-l<.10:continue
  x0=int(W*(l+.22*(r-l)));x1=int(W*(r-.22*(r-l)))
  y0=int(H*(t+.23*(b-t)));y1=int(H*(t+.49*(b-t)))
  y2=int(H*(t+.61*(b-t)));y3=int(H*(t+.89*(b-t)))
  if x1-x0<12 or y1-y0<12 or y3-y2<12:continue
  image=np.frombuffer(raw[idx*N:(idx+1)*N],dtype=np.uint8).reshape(H,W,3)
  up=image[y0:y1,x0:x1].reshape(-1,3)
  down=image[y2:y3,x0:x1].reshape(-1,3)
  if up.shape[0]<200 or down.shape[0]<200:continue
  both=np.vstack((up,down))
  lum=np.mean(both.astype(np.float32),axis=1)
  if not 48<float(np.median(lum))<213 or float(np.std(lum))<18:continue
  h=[]
  for arr in (up,down):
   for k in range(3):
    counts=np.histogram(arr[:,k],bins=8,range=(0,256))[0].astype(np.float32)
    counts/=max(1,float(counts.sum()))
    h.extend(float(z) for z in counts)
  if len(h)!=48:raise AssertionError("unexpected_appearance_vector_shape")
  vectors.append(h);positions.append(ev.get("centers",[]))
 if len(vectors)<3:return {"quality":"insufficient_clear_single_person_samples","sample_frames":len(vectors),"vector":None}
 arr=np.median(np.asarray(vectors,dtype=np.float32),axis=0)
 for i in range(6):
  arr[i*8:(i+1)*8]/=max(1e-6,float(arr[i*8:(i+1)*8].sum()))
 return {"quality":"clear_clothing_color_candidate","sample_frames":len(vectors),
   "vector":[round(float(z),5) for z in arr]}

def compare(first,second):
 if not isinstance(first,list) or not isinstance(second,list) or len(first)!=48 or len(second)!=48:return None
 try:
  if any(not math.isfinite(x) or not 0<=x<=1 for x in first+second):return None
 except TypeError:return None
 return round(sum(min(a,b) for a,b in zip(first,second))/6,4)

def approximate_utc(name):
 m=re.search(r"(?:NEW|S3)_(20\d{12})",str(name))
 if not m:return None
 try:return datetime.datetime.strptime(m.group(1),"%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
 except ValueError:return None

def candidates(item,other_items,max_result=3):
 """Return cautious *review suggestions*; never assign recurring visitor IDs."""
 if item.get("appearance_quality")!="clear_clothing_color_candidate":return []
 if item.get("category") not in ("single_person_event_candidate","possible_person_needs_review"):return []
 when=approximate_utc(item.get("remote_name"))
 if when is None:return []
 out=[]
 for other in other_items:
  if item.get("clip_id")==other.get("clip_id") or item.get("camera")!=other.get("camera"):continue
  if other.get("category") not in ("single_person_event_candidate","possible_person_needs_review"):continue
  if other.get("appearance_quality")!="clear_clothing_color_candidate":continue
  dt=approximate_utc(other.get("remote_name"))
  if dt is None or abs((dt-when).total_seconds())>12*3600:continue
  score=compare(item.get("appearance_vector"),other.get("appearance_vector"))
  if score is None or score<.955:continue
  out.append({"clip_id":other.get("clip_id"),"appearance_similarity":score,
    "reason":"similar_clothing_within_12h_same_camera",
    "verified_same_person":False,"human_review_required":True})
 return sorted(out,key=lambda r:r["appearance_similarity"],reverse=True)[:max(0,min(5,max_result))]
