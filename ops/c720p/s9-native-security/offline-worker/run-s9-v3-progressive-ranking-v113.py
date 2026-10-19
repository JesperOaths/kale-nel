#!/usr/bin/env python3
"""Low-duty V3 appearance index publication from existing verified phone crops.

Never records video, assigns a person or changes Camera2. The independently
merged V3 ranker owns all device/thermal checks, cross-worker locks, source
integrity validation, on-phone computation, and fail-closed pointer promotion.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

HERE=Path(__file__).resolve().parent
HASH=re.compile(r"[a-f0-9]{64}")
CORPUS=re.compile(r"[a-f0-9]{16}")
class SharedWorkerBusy(Exception):
    """The ranking worker has not started any phone or index changes."""


ALLOW_DEFERRALS={
 "capture_too_warm_for_ranker":"capture_warm",
 "capture_not_idle_4k_ring_healthy":"capture_not_ready",
 "S9+ above cool ranking temperature; no run":"battery_warm",
 "V3 requires complete original V2 references plus one extra real descriptor":"descriptors_incomplete",
 "S9 sidecar transfer indeterminate; no index published":"sidecar_transfer_unreliable",
}
def module():
 path=HERE/"run-s9-uniform-appearance-rankings-v3.py"
 spec=importlib.util.spec_from_file_location("s9_v3_progressive_existing_ranker",path)
 obj=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(obj)
 return obj

def corpus_for(rows,ranker):
 entries=[{"key":x["key"],"aligned_face_verified":False,
           "visual_sidecar_sha256":x["visual_sidecar_sha256"],
           "hsv_sidecar_sha256":x["hsv_sidecar_sha256"]} for x in rows]
 data="".join(json.dumps(e,separators=(",",":"))+chr(10) for e in entries).encode()
 return ranker.digest(data)[:16]

def read_pointer(path):
 if path.is_symlink():raise RuntimeError("untrusted_active_pointer_symlink")
 if not path.exists():return None
 if not path.is_file() or path.stat().st_size>4096:
  raise RuntimeError("untrusted_active_pointer")
 doc=json.loads(path.read_text(encoding="utf-8"))
 if (not isinstance(doc,dict) or
     doc.get("schema")!="s9_appearance_v3_active_v1" or
     not CORPUS.fullmatch(str(doc.get("corpus_id",""))) or
     type(doc.get("verified_crops")) is not int or
     not 58<=doc["verified_crops"]<=400 or
     doc.get("human_review_required") is not True or
     doc.get("automatic_person_assignments")!=0 or
     not all(HASH.fullmatch(str(doc.get(k,""))) for k in
             ("map_sha256","rankings_sha256"))):
  raise RuntimeError("untrusted_active_v3_pointer")
 return doc

def decision(current,corpus_id,count):
 if not CORPUS.fullmatch(corpus_id) or not 58<=count<=400:
  raise RuntimeError("invalid_expected_corpus")
 if current is None:return "needs_first_index"
 if current["verified_crops"]>count:
  raise RuntimeError("index_population_regressed")
 if current["verified_crops"]==count:
  if current["corpus_id"]==corpus_id:return "already_current"
  # Same-size changed source data may reflect edited/revoked references.
  # The production v3 publisher rightly requires a separate review here.
  raise RuntimeError("same_size_source_changes_require_review")
 if current["corpus_id"]==corpus_id:
  raise RuntimeError("inconsistent_active_corpus")
 return "needs_expansion"

def guarded_publish(ranker,expected_id,count):
 worker=HERE/"run-s9-uniform-appearance-rankings-v3.py"
 proc=subprocess.run([sys.executable,str(worker),"--apply"],
                     capture_output=True,text=True,timeout=780)
 if proc.returncode==75:
  markers=[line for line in proc.stdout.splitlines()
           if line.startswith("S9_V3_RANKER_DEFERRED ")]
  if len(markers)==1:
   try:
    status=json.loads(markers[0].split("S9_V3_RANKER_DEFERRED ",1)[1])
   except (json.JSONDecodeError,ValueError):
    status={}
   if (status.get("reason")=="shared_archive_worker_busy"
       and status.get("rankings_published") is False
       and status.get("automatic_person_assignments")==0):
    raise SharedWorkerBusy() from None
 if proc.returncode:
  # Never disclose potentially private stderr or crop identifiers.
  raise RuntimeError("guarded_ranker_failed_or_capture_changed")
 markers=[l.split("S9_V3_MODEL_BACKED_RANKINGS_PRODUCED ",1)[1]
          for l in proc.stdout.splitlines()
          if l.startswith("S9_V3_MODEL_BACKED_RANKINGS_PRODUCED ")]
 if len(markers)!=1:raise RuntimeError("ranker_completion_not_verified")
 doc=json.loads(markers[0])
 if (doc.get("corpus_id")!=expected_id or
     doc.get("verified_uniform_crop_records")!=count or
     doc.get("v1_v2_indices_sha256_unchanged") is not True or
     doc.get("camera_apk_changed") is not False or
     doc.get("recordings_changed") is not False or
     doc.get("manual_reviews_changed") is not False or
     doc.get("identity_probabilities") is not False or
     not HASH.fullmatch(str(doc.get("phone_rankings_sha256","")))):
  raise RuntimeError("phone_v3_ranker_postcondition_invalid")
 current=read_pointer(ranker.STATE_DIR/"s9-multivector-v3-active.json")
 if (current is None or current["corpus_id"]!=expected_id or
     current["verified_crops"]!=count or
     current["rankings_sha256"]!=doc["phone_rankings_sha256"]):
  raise RuntimeError("published_active_index_does_not_match_phone")
 return {"verified_crops":count,"active_index_published":True,
         "v1_v2_unchanged":True,"originals_unchanged":True,
         "manual_decisions_unchanged":True,"camera_apk_unchanged":True,
         "automatic_assignments":0}

def run(apply=False,ranker=None):
 m=ranker if ranker is not None else module()
 try:
  # Do not even scan the metadata catalog if the continuous 4K camera is hot,
  # thermally fallen back, recording, dropping frames or doing other work.
  m.capture_rank_safe()
  m.phone_temperature_c()
  rows=m.source_inventory()
  m.verified_v2_baseline(rows)
 except RuntimeError as error:
  reason=ALLOW_DEFERRALS.get(str(error))
  if reason:
   print("S9_V3_PROGRESSIVE_RANKING_DEFERRED "+
     json.dumps({"reason":reason,"rankings_published":False,
                 "capture_modified":False,"identities_assigned":0}),flush=True)
   return "deferred"
  raise
 count=len(rows)
 expected=corpus_for(rows,m)
 current=read_pointer(m.STATE_DIR/"s9-multivector-v3-active.json")
 plan=decision(current,expected,count)
 if plan=="already_current":
  print("S9_V3_PROGRESSIVE_RANKING_CURRENT "+
    json.dumps({"verified_crops":count,"rankings_published":False,
                "originals_modified":False,"identities_assigned":0}),flush=True)
  return "current"
 if not apply:
  print("S9_V3_PROGRESSIVE_RANKING_PREFLIGHT "+
   json.dumps({"verified_crops":count,"work":plan,
               "rankings_published":False,"identities_assigned":0}),flush=True)
  return "preflight"
 try:
  result=guarded_publish(m,expected,count)
 except SharedWorkerBusy:
  print("S9_V3_PROGRESSIVE_RANKING_DEFERRED "+json.dumps({
      "reason":"shared_archive_worker_busy","rankings_published":False,
      "capture_modified":False,"identities_assigned":0}),flush=True)
  return "deferred"
 print("S9_V3_PROGRESSIVE_RANKING_VERIFIED "+json.dumps(result,sort_keys=True),
       flush=True)
 return "verified"

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 run(args.apply)
