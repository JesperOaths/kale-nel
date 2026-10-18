#!/usr/bin/env python3
"""C720P-local, read-only resolution/illumination/sharpness audit.

Only JPEGs from the verified S9 microSD catalog are decoded, and only aggregate
quality bins leave this process. This is NOT a biometric accuracy benchmark or
a face identity classifier. No image/video is written to the C720P.
Run using the existing person-detector venv (cv2 + numpy already installed).
"""
from collections import Counter
import hashlib
import json
import re
import urllib.parse
import urllib.request

CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
FACE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
DIGEST=re.compile(r"[0-9a-f]{64}\Z")
CATALOG="http://127.0.0.1:8795/new/api/saved"
PREFIX="http://127.0.0.1:8795/new/saved/face/"
MAX_CATALOG=5_000_000
MAX_JPEG=2_400_000
MAX_FACES=3000

def read_bounded(uri,limit,timeout=10):
 with urllib.request.urlopen(uri,timeout=timeout) as stream:
  if stream.status!=200:raise ValueError("source_not_available")
  data=stream.read(limit+1)
 if len(data)>limit:raise ValueError("bounded_source_overflow")
 return data

def quality_bins(side,brightness,contrast,laplacian):
 """Descriptive image properties, NOT acceptance of a face identity."""
 if side<112:size="under_112px_model_input"
 elif side<160:size="112_to_159px"
 elif side<240:size="160_to_239px"
 else:size="at_least_240px"
 if brightness<45:lighting="very_dark"
 elif brightness<85:lighting="dim"
 elif brightness>220:lighting="very_bright"
 else:lighting="not_extreme"
 # Laplacian pixel variance is a heuristic; never a calibrated recognition score.
 if laplacian<40:focus="low_edge_variance"
 elif laplacian<120:focus="medium_edge_variance"
 else:focus="high_edge_variance"
 if contrast<20:tonality="low_contrast"
 else:tonality="normal_contrast"
 return size,lighting,focus,tonality

def sources(catalog):
 if not isinstance(catalog,dict) or catalog.get("archive_mode")!="S9-microSD-only":
  raise ValueError("verified_archive_missing")
 events=catalog.get("events")
 if not isinstance(events,list) or not events or len(events)>3000:
  raise ValueError("archive_shape_changed")
 out={}
 for row in events:
  if not isinstance(row,dict) or not CLIP.fullmatch(str(row.get("clip_no",""))):
   raise ValueError("unverified_source_clip")
  clip=row["clip_no"]
  faces=row.get("face_candidates")
  if not isinstance(faces,list) or len(faces)>16:raise ValueError("face_list_shape_changed")
  for face in faces:
   if not isinstance(face,dict):raise ValueError("face_metadata_invalid")
   name=face.get("snapshot_name")
   if name is None:continue
   if (not isinstance(name,str) or not FACE.fullmatch(name)
       or not name.startswith(clip[:-4]+"__") or name in out):
    raise ValueError("duplicate_or_untrusted_face_reference")
   # Do not use identity metadata; only integrity and source information.
   sha=face.get("snapshot_sha256")
   if not isinstance(sha,str) or not DIGEST.fullmatch(sha):
    raise ValueError("untrusted_snapshot_digest")
   out[name]=sha
 if not out or len(out)>MAX_FACES:raise ValueError("face_sample_bound_exceeded")
 return out

def analyse(source_map,read_image,decode):
 counts=Counter()
 sizes=Counter()
 light=Counter()
 sharp=Counter()
 contrast_bins=Counter()
 failed=Counter()
 for name,expected_sha in source_map.items():
  try:
   body=read_image(PREFIX+urllib.parse.quote(name,safe=""),MAX_JPEG,8)
   if not body.startswith(b"\xff\xd8"):raise ValueError("not_jpeg")
   actual=hashlib.sha256(body).hexdigest()
   if actual!=expected_sha:raise ValueError("jpeg_source_sha_mismatch")
   width,height,brightness,contrast,edge_variance=decode(body)
   if not (0<width<=3840 and 0<height<=2160):
    raise ValueError("decoded_image_dimensions_invalid")
   labels=quality_bins(min(width,height),brightness,contrast,edge_variance)
   sizes[labels[0]]+=1;light[labels[1]]+=1
   sharp[labels[2]]+=1;contrast_bins[labels[3]]+=1
   counts["inspected_jpeg"]+=1
  except (OSError,ValueError,TimeoutError) as e:
   label=str(e)
   if label not in ("not_jpeg","jpeg_source_sha_mismatch",
     "decoded_image_dimensions_invalid","bounded_source_overflow",
     "source_not_available"):label="source_read_or_decode_error"
   failed[label]+=1
 counts["total_referenced"]=len(source_map)
 return {"status":"complete" if not failed else "source_integrity_or_read_failure",
   "referenced_face_images":counts["total_referenced"],
   "decoded_verified":counts["inspected_jpeg"],
   "source_errors":dict(failed),
   "native_side_bins":dict(sizes),
   "brightness_bins":dict(light),
   "edge_variance_bins":dict(sharp),
   "contrast_bins":dict(contrast_bins),
   "source_hashes_verified":counts["inspected_jpeg"],
   "manual_visual_review_allowed":True,
   "recognition_accuracy_validated":False,
   "model_matching_enabled":False,
   "raw_frames_written":False,
   "face_bytes_exported":False,
   "original_recordings_modified":False}

def cv2_decoder():
 import cv2
 import numpy as np
 def decode(raw):
  arr=np.frombuffer(raw,np.uint8)
  image=cv2.imdecode(arr,cv2.IMREAD_GRAYSCALE)
  if image is None:raise ValueError("source_read_or_decode_error")
  height,width=image.shape
  return (width,height,float(np.mean(image)),float(np.std(image)),
          float(cv2.Laplacian(image,cv2.CV_64F).var()))
 return decode

def main():
 metadata=json.loads(read_bounded(CATALOG,MAX_CATALOG,15))
 originals=sources(metadata)
 result=analyse(originals,read_bounded,cv2_decoder())
 print("S9_FACE_SOURCE_QUALITY_AUDIT "+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":main()
