#!/usr/bin/env python3
"""Synthetic read-only review overlay precedence and group-reference tests."""
import contextlib
from collections import defaultdict
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
FILES=[
 ROOT/"backfill-s9-original-person-roi-osnet.py",
 ROOT/"backfill-s9-original-roi-osnet-temporal-v2.py",
]
READINESS=ROOT.parent/"audit-auto-person-reference-readiness.py"
CLIP_A="motion_1792200000000.mp4"
CLIP_B="motion_1792200100000.mp4"
CLIP_C="motion_1792200200000.mp4"
CLIP_D="motion_1792200300000.mp4"
def load(path):
 spec=importlib.util.spec_from_file_location("overlay_"+path.stem.replace("-","_"),path)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod
def request_for(entries):
 def request(endpoint,**unused):
  if endpoint=="/new/api/s9-manual-recording-links":
   return {"ok":True,"manual_links_only":True,"items":entries}
  if endpoint.endswith("tab=all&offset=0&limit=100"):
   return {"ok":True,"folders":[{"id":"G123"},{"id":"G456"}]}
  if "tab=approved" in endpoint:
   person="G123" if "folder=G123" in endpoint else "G456"
   selected=[CLIP_A,CLIP_B,CLIP_C] if person=="G123" else [CLIP_B]
   return {"ok":True,"items":[{"clip":x} for x in selected],"total":len(selected)}
  raise AssertionError("Unexpected metadata-only endpoint "+endpoint)
 return request

class ReviewOverlayTests(unittest.TestCase):
 def test_approved_reference_selection_honors_group_and_withdrawals(self):
  explicit={
   "sd:"+CLIP_A:{"folder":None,"folders":[],"review_status":"inbox"},
   "sd:"+CLIP_B:{"folder":"G456","folders":["G456","G789"],"review_status":"assigned"},
   "sd:"+CLIP_C:{"folder":None,"folders":[],"review_status":"skipped"},
   "sd:"+CLIP_D:{"folder":"G123","review_status":"assigned"},
   "drive:"+CLIP_A:{"folder":"G123","folders":["G123"],"review_status":"assigned"},
  }
  for path in FILES:
   with self.subTest(worker=path.name):
    mod=load(path)
    with patch.object(mod,"request",request_for(explicit)):
     self.assertEqual(mod.approved_names(),{CLIP_B,CLIP_D})
 def test_original_legacy_decisions_retained_when_no_override(self):
  for path in FILES:
   mod=load(path)
   with patch.object(mod,"request",request_for({})):
    self.assertEqual(mod.approved_names(),{CLIP_A,CLIP_B,CLIP_C})
 def test_malformed_explicit_overlay_fails_closed(self):
  entries={"sd:"+CLIP_A:{"folder":"../evil","folders":["../evil"],"review_status":"assigned"}}
  for path in FILES:
   mod=load(path)
   with patch.object(mod,"request",request_for(entries)):
    with self.assertRaises(RuntimeError):
     mod.approved_names()

 def test_auto_readiness_does_not_revive_withdrawn_or_skip_group_links(self):
  mod=load(READINESS)
  primary=[{"clip_no":k,"face_candidates":[]} for k in (CLIP_A,CLIP_B,CLIP_C,CLIP_D)]
  entries={
   "sd:"+CLIP_A:{"folder":None,"folders":[],"review_status":"inbox"},
   "sd:"+CLIP_B:{"folder":"G456","folders":["G456","G789"],"review_status":"assigned"},
   "sd:"+CLIP_C:{"folder":None,"folders":[],"review_status":"rejected"},
   "sd:"+CLIP_D:{"folder":"G123","review_status":"assigned"},
  }
  def read(path,**kwargs):
   if path=="/new/api/saved":return {"archive_mode":"S9-microSD-only","events":primary}
   if path=="/new/api/s9-manual-recording-links":return {"manual_links_only":True,"items":entries}
   if path=="/new/api/drive-saved":return {"ok":True,"events":[]}
   raise AssertionError(path)
  with patch.object(mod,"read",read),patch.object(mod,"review",return_value={
       "folders":[{"id":"G123","approved_clips":3},{"id":"G456","approved_clips":1}]}),patch.object(mod,"approved_by_folder",return_value=defaultdict(set,{
        "G123":{CLIP_A,CLIP_B,CLIP_C},"G456":{CLIP_B}})):
   out=io.StringIO()
   with contextlib.redirect_stdout(out):mod.main()
   text=out.getvalue()
   self.assertTrue(text.startswith("S9_AUTO_PERSON_REAL_EVIDENCE_READINESS "))
   doc=json.loads(text.split(" ",1)[1])
   self.assertEqual(doc["distinct_approved_sd_clips"],2)
   self.assertEqual(doc["unassigned_sd_clips"],2)
   self.assertEqual(doc["saved_person_folders"],2)

if __name__=="__main__":unittest.main(verbosity=2)
