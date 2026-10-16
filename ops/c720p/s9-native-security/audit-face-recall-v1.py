#!/usr/bin/env python3
"""Local aggregate diagnosis: sampled person/face presence, no pixels or IDs."""
import collections,json,urllib.request
from pathlib import Path
URL="http://127.0.0.1:8795/new/api/saved"
with urllib.request.urlopen(URL,timeout=16) as stream:
 data=json.load(stream)
assert data.get("archive_mode")=="S9-microSD-only"
rows=[r for r in data.get("events",[]) if
 str(r.get("clip_no","")).startswith("motion_")]
counter=collections.Counter()
fail=collections.Counter()
for r in rows:
 p=int(r.get("person_count") or 0)
 counter["clips_total"]+=1
 counter["person_model_positive" if p>0 else "person_model_negative"]+=1
 n=r.get("face_review_sampled_frames")
 counter["face_review_available" if type(n) is int else "face_review_unavailable"]+=1
 counter["face_review_deep_36" if n==36 else "face_review_other"]+=1
 if int(r.get("face_snapshots_saved") or 0)>0:counter["face_snapshots_exist"]+=1
 elif p>0:counter["person_positive_but_no_face"]+=1
 elif int(r.get("sampled_frames") or 0)>0:counter["negative_person_sampled"]+=1
 outcome=str(r.get("face_evidence_outcome") or "unknown")
 fail["outcome:"+outcome]+=1
 for k in ("face_detector_raw_hits","face_rejected_confidence_or_size",
   "face_rejected_looking_away_or_roll","face_rejected_crop_geometry",
   "face_rejected_dark_or_blurry","face_deep_person_roi_anchors",
   "face_deep_multiple_person_anchors"):
  v=r.get(k)
  if type(v) is int:fail[k]+=v
 status=str(r.get("face_model_state") or "missing")
 fail["model:"+status]+=1
report={"counts":dict(counter),"diagnostics":dict(fail),
 "camera_apk_untouched":True,"recordings_untouched":True,
 "person_identity_accessed":False,"image_bytes_accessed":False}
print("S9_FACE_RECALL_BASELINE_V1 "+json.dumps(report,sort_keys=True),flush=True)
