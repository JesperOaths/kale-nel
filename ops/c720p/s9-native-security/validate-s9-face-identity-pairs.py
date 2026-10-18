#!/usr/bin/env python3
"""Fail-closed, metadata-only evaluation of independently human-labeled face pairs.

Does NOT identify anybody, touch recordings, infer labels, use face images, or
expose embeddings. Evaluation data must originate from reviewed original-4K
clip pairs and PHONE-MEASURED scores, never from appearance-only suggestions.
"""
import json
from math import sqrt
from pathlib import Path
import re

PAIR=re.compile(r"motion_[0-9]{13}[.]mp4$")
FACE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg$")
DIGEST=re.compile(r"[0-9a-f]{64}$")
THRESHOLDS={"anonymous":0.88,"known":0.84}
MIN_POS=40
MIN_NEG=500
MAX_FAR_95_UPPER=0.01
MIN_TPR=0.90
GATE_VERSION="s9_face_identity_qualification_v2"
PRIVATE=Path("/home/jespern/c720p-home-hub/state/s9-human-confirmed-face-pairs-v2.json")

def wilson_upper(failures,total,z=1.96):
 if total<=0:return 1.0
 p=failures/total
 den=1+z*z/total
 center=p+z*z/(2*total)
 radius=z*sqrt(max(0,p*(1-p)/total+z*z/(4*total*total)))
 return min(1.0,(center+radius)/den)

def wilson_lower(successes,total,z=1.96):
 if total<=0:return 0.0
 p=successes/total
 den=1+z*z/total
 center=p+z*z/(2*total)
 radius=z*sqrt(max(0,p*(1-p)/total+z*z/(4*total*total)))
 return max(0.0,(center-radius)/den)

def evaluate(doc):
 base={"qualification_version":GATE_VERSION,"qualified_for_automated_grouping":False,
   "identity_claims_enabled":False,"reason":"verified_labels_unavailable",
   "positive_confirmed_pairs":0,"negative_confirmed_pairs":0,
   "calibration_false_acceptances":None,"calibration_false_rejections":None,
   "false_acceptance_95pct_upper":1.0,
   "true_positive_95pct_lower":0.0,
   "biometric_templates_exported":False,"original_video_modified":False}
 if doc is None:return base
 if not isinstance(doc,dict) or doc.get("version")!=2 or doc.get("origin")!="independent_human_confirmed_4k_face_pair_review":
  raise ValueError("human_ground_truth_provenance_missing")
 if not DIGEST.fullmatch(str(doc.get("model_sha256",""))):
  raise ValueError("invalid_model_version")
 rows=doc.get("pairs")
 if not isinstance(rows,list) or len(rows)>10000:
  raise ValueError("invalid_label_corpus")
 if not rows:return base
 seen=set();seen_faces=set();pos=[];neg=[];clips=set();days=set()
 for row in rows:
  if not isinstance(row,dict) or set(row)!={"left_clip","right_clip",
      "left_snapshot_name","right_snapshot_name",
      "left_snapshot_sha256","right_snapshot_sha256",
      "truth","score","margin","category","human_confirmed",
      "original_4k_verified","phone_model_verified",
      "independent_reviewer_verified","pair_score_origin"}:
   raise ValueError("invalid_pair_record")
  a,b=row["left_clip"],row["right_clip"]
  if not isinstance(a,str) or not isinstance(b,str) or not PAIR.fullmatch(a) or not PAIR.fullmatch(b) or a==b:
   raise ValueError("invalid_distinct_4k_clips")
  left_face,right_face=row["left_snapshot_name"],row["right_snapshot_name"]
  if (not isinstance(left_face,str) or not isinstance(right_face,str) or
      not FACE.fullmatch(left_face) or not FACE.fullmatch(right_face) or
      not left_face.startswith(a[:-4]+"__") or
      not right_face.startswith(b[:-4]+"__") or
      left_face==right_face):
   raise ValueError("comparison_face_refs_do_not_match_originals")
  if not DIGEST.fullmatch(str(row["left_snapshot_sha256"])) or not DIGEST.fullmatch(str(row["right_snapshot_sha256"])):
   raise ValueError("unverified_image_digest")
  if row["pair_score_origin"]!="s9_local_exact_face_pair_score_v1":
   raise ValueError("score_not_tied_to_exact_phone_face_pair")
  pair_id=tuple(sorted(((left_face,row["left_snapshot_sha256"]),
                       (right_face,row["right_snapshot_sha256"]))))
  if pair_id in seen_faces:raise ValueError("reused_exact_face_pair")
  seen_faces.add(pair_id)
  key=tuple(sorted((a,b)))
  if key in seen:raise ValueError("reused_clip_pair_requires_independent_pair_selection")
  seen.add(key);clips.update(key)
  for item in key:
   days.add(int(item[7:20])//86400000)
  if (row["human_confirmed"] is not True or
      row["independent_reviewer_verified"] is not True or
      row["original_4k_verified"] is not True or
      row["phone_model_verified"] is not True):
   raise ValueError("independent_ground_truth_missing")
  if row["truth"] not in ("same_person","different_people"):
   raise ValueError("unconfirmed_truth_label")
  category=row["category"]
  if category not in THRESHOLDS:raise ValueError("unverified_similarity_category")
  score,margin=row["score"],row["margin"]
  if type(score) not in (int,float) or type(margin) not in (int,float) or not -1<=score<=1 or not 0<=margin<=2:
   raise ValueError("invalid_local_similarity")
  accepted=score>=THRESHOLDS[category] and margin>=0.045
  (pos if row["truth"]=="same_person" else neg).append(accepted)
 false_accept=sum(neg)
 false_reject=len(pos)-sum(pos)
 far_upper=wilson_upper(false_accept,len(neg))
 tpr=(sum(pos)/len(pos)) if pos else 0
 tpr_lower=wilson_lower(sum(pos),len(pos))
 base.update(positive_confirmed_pairs=len(pos),negative_confirmed_pairs=len(neg),
   distinct_source_clips=len(clips),distinct_capture_days=len(days),
   calibration_false_acceptances=false_accept,
   calibration_false_rejections=false_reject,
   false_acceptance_95pct_upper=round(far_upper,5),
   true_positive_rate=round(tpr,5),
   true_positive_95pct_lower=round(tpr_lower,5),
   model_sha256_prefix=doc["model_sha256"][:12])
 meets=len(pos)>=MIN_POS and len(neg)>=MIN_NEG and len(clips)>=60 and len(days)>=3 and far_upper<=MAX_FAR_95_UPPER and tpr_lower>=MIN_TPR
 # Validation alone does NOT authorize autonomous identity decisions: a
 # separate explicit approval and genuine field pilot are required.
 base["reason"]="passed_offline_calibration_requires_independent_approval" if meets else "insufficient_or_failed_real_pair_validation"
 base["offline_thresholds_pass"]=meets
 return base

def main():
 if not PRIVATE.is_file():
  result=evaluate(None)
 else:
  if PRIVATE.is_symlink() or PRIVATE.stat().st_size>2000000:
   raise RuntimeError("private_label_corpus_invalid")
  result=evaluate(json.loads(PRIVATE.read_text(encoding="utf-8")))
 print("S9_FACE_IDENTITY_QUALIFICATION "+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":main()
