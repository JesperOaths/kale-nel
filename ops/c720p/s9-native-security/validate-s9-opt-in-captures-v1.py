#!/usr/bin/env python3
"""Read-only, consent-scoped Step 3 capture readiness; never a biometric matcher.

No participant is inferred from an image. A consent/capture manifest is entered
by a responsible human, verified against archived source metadata, and remains
a REVIEW CANDIDATE. Its asserted labels NEVER enter model-accuracy statistics.
"""
from collections import Counter
import json
from pathlib import Path
import re
import urllib.request

PRIVATE=Path("/home/jespern/c720p-home-hub/state/s9-opt-in-face-validation-v1.json")
SOURCE="http://127.0.0.1:8795/new/api/saved"
CODE=re.compile(r"V-[A-Z0-9]{12}\Z")
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
IMAGE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
PURPOSE="explicit_opt_in_face_validation_only"

def digest(value):
 return isinstance(value,str) and bool(SHA.fullmatch(value))

def summarize(doc,archive):
 result={"status":"missing_opt_in_participant_manifest",
   "opted_in_participants":0,"verified_original_clip_samples":0,
   "distinct_source_days":0,"possible_same_subject_pair_tasks":0,
   "possible_different_subject_pair_tasks":0,
   "these_are_not_ground_truth_labels":True,
   "automatic_recognition_enabled":False,
   "biometric_images_exported":False,"original_recordings_modified":False,
   "read_only":True}
 if doc is None:return result
 if (not isinstance(doc,dict) or doc.get("version")!=1 or
     doc.get("purpose")!=PURPOSE or
     not isinstance(doc.get("participants"),list) or
     not isinstance(doc.get("captures"),list)):
  raise ValueError("opt_in_capture_manifest_shape_invalid")
 if len(doc["participants"])>150 or len(doc["captures"])>5000:
  raise ValueError("opt_in_data_bound_exceeded")
 if not isinstance(archive,dict) or archive.get("archive_mode")!="S9-microSD-only":
  raise ValueError("verified_original_archive_unavailable")
 events=archive.get("events")
 if not isinstance(events,list):raise ValueError("archive_not_verified")
 seen={}
 for rec in events:
  clip=rec.get("clip_no") if isinstance(rec,dict) else None
  if not isinstance(clip,str) or not CLIP.fullmatch(clip) or clip in seen:
   raise ValueError("source_clip_untrusted")
  faces={}
  for face in rec.get("face_candidates") or []:
   if not isinstance(face,dict):raise ValueError("face_source_untrusted")
   name=face.get("snapshot_name")
   if not name:continue
   if not isinstance(name,str) or not IMAGE.fullmatch(name):
    raise ValueError("face_source_untrusted")
   if name in faces:raise ValueError("duplicate_face_source")
   faces[name]=face.get("snapshot_sha256")
  seen[clip]=faces
 consents={}
 for p in doc["participants"]:
  if not isinstance(p,dict) or set(p)!={
     "subject_code","consent_document_sha256","adult_verified",
     "consent_scope","withdrawn","consent_human_verified"}:
   raise ValueError("participant_consent_record_untrusted")
  code=p["subject_code"]
  if not isinstance(code,str) or not CODE.fullmatch(code) or code in consents:
   raise ValueError("participant_code_invalid_or_reused")
  if (not digest(p["consent_document_sha256"]) or
      p["adult_verified"] is not True or
      p["consent_human_verified"] is not True or
      p["consent_scope"]!=PURPOSE):
   raise ValueError("valid_specific_opt_in_consent_missing")
  consents[code]=p["withdrawn"] is False
 captures=Counter()
 clips=set()
 days=set()
 verified=set()
 for row in doc["captures"]:
  if not isinstance(row,dict) or set(row)!={
      "subject_code","clip_no","snapshot_name","snapshot_sha256",
      "human_original_and_face_reviewed"}:
   raise ValueError("opt_in_capture_reference_untrusted")
  code,clip,name=row["subject_code"],row["clip_no"],row["snapshot_name"]
  if not isinstance(code,str) or code not in consents or not consents[code]:
   raise ValueError("capture_subject_has_no_active_consent")
  if (not isinstance(clip,str) or not CLIP.fullmatch(clip) or
      not isinstance(name,str) or not IMAGE.fullmatch(name) or
      not name.startswith(clip[:-4]+"__") or
      not digest(row["snapshot_sha256"]) or
      row["human_original_and_face_reviewed"] is not True):
   raise ValueError("unverified_exact_face_capture")
  if clip not in seen or seen[clip].get(name)!=row["snapshot_sha256"]:
   raise ValueError("capture_not_in_original_verified_4k_catalog")
  if name in verified or clip in clips:
   # Deliberately one explicitly reviewed face per original clip:
   # multiple people in one clip are otherwise ambiguous.
   raise ValueError("ambiguous_or_reused_capture")
  verified.add(name);clips.add(clip)
  captures[code]+=1
  days.add(int(clip[7:20])//86400000)
 active=sum(consents.values())
 n=sum(captures.values())
 pos=sum(k*(k-1)//2 for k in captures.values())
 neg=sum((n*n-sum(k*k for k in captures.values()))//2 for _ in [0])
 result.update(status="opt_in_review_candidates_present" if n else
               "no_explicit_opt_in_captures_yet",
    opted_in_participants=active,verified_original_clip_samples=n,
    distinct_source_days=len(days),
    possible_same_subject_pair_tasks=pos,
    possible_different_subject_pair_tasks=neg,
    enough_potential_tasks_for_manual_review=(
      active>=2 and n>=60 and len(days)>=3 and pos>=40 and neg>=500))
 return result

def main():
 if PRIVATE.exists():
  if PRIVATE.is_symlink() or PRIVATE.stat().st_size>2_000_000:
   raise RuntimeError("private_consent_file_untrusted")
  doc=json.loads(PRIVATE.read_text(encoding="utf-8"))
 else:doc=None
 if doc is None:
  result=summarize(None,None)
 else:
  with urllib.request.urlopen(SOURCE,timeout=20) as request:
   raw=request.read(5_000_001)
  if len(raw)>5_000_000:raise RuntimeError("archive_too_large")
  result=summarize(doc,json.loads(raw))
 print("S9_OPT_IN_VALIDATION_READINESS "+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":main()
