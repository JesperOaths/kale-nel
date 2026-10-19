#!/usr/bin/env python3
"""Synthetic private face proposal review cases. Never reads actual faces."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SRC=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_automatic_person_review.py"
spec=importlib.util.spec_from_file_location("s9_auto_person",SRC)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
CLIP="motion_1792200000000.mp4"
SHA="a"*64
MODEL="b"*64
FOLDER="G123"

class AutoPersonReviewTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  for name,filename in (("STATE",""),("SOURCE","suggestions.json"),("REJECTED","denied.json"),
                        ("LOCK","review.lock"),("AUDIT","denied.audit.jsonl")):
   p=Path(self.tmp.name)/filename if filename else Path(self.tmp.name)
   patcher=patch.object(mod,name,p);patcher.start();self.addCleanup(patcher.stop)
  self.sd={CLIP:{"sd_verified":True}}
  self.links={}
 def write(self,**overrides):
  row={"source":"sd","name":CLIP,"folder":FOLDER,
       "snapshot_sha256":SHA,"model_sha256":MODEL,
       "aligned_face":True,"human_confirmed_reference":True,
       "pair_score_origin":"s9_local_exact_face_pair_score_v1",
       "reference_count":2,"score":.94,"margin":.11}
  row.update(overrides)
  mod.SOURCE.write_text(json.dumps({"version":1,
   "origin":"s9_offline_aligned_face_embeddings","model_sha256":MODEL,
   "suggestions":[row]}))
 def deny(self,id,revision=0):
  return mod.deny({"action":"deny","id":id,"revision":revision,
                   "human_confirmed":True},self.sd,self.links)
 def test_empty_state_requires_real_face_embeddings(self):
  data=mod.report(self.sd,self.links)
  self.assertEqual(data["status"],"face_embedding_index_not_ready")
  self.assertFalse(data["automatic_assignments"])
  self.assertEqual(data["items"],[])
 def test_eligible_proposals_require_human_approval(self):
  self.write()
  data=mod.report(self.sd,self.links)
  self.assertEqual(len(data["items"]),1)
  self.assertFalse(data["items"][0]["human_approved"])
  self.assertEqual(data["items"][0]["folder"],FOLDER)
  self.assertTrue(data["human_approval_required"])
 def test_invalid_model_and_unaligned_crops_never_propose(self):
  for overrides in ({"aligned_face":False},{"reference_count":1},
                    {"margin":.01},{"score":.4},{"model_sha256":"c"*64},
                    {"pair_score_origin":"hsv_color_match"},
                    {"human_confirmed_reference":False}):
   with self.subTest(overrides=overrides):
    self.write(**overrides)
    self.assertEqual(mod.report(self.sd,self.links)["items"],[])
 def test_already_filed_and_missing_sd_are_hidden(self):
  self.write()
  self.assertEqual(mod.report({},self.links)["items"],[])
  self.links["sd:"+CLIP]={"folder":"G999"}
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
 def test_deny_is_audited_and_revision_safe(self):
  self.write();item=mod.report(self.sd,self.links)["items"][0]
  code,data=self.deny(item["id"])
  self.assertEqual(code,200)
  self.assertEqual(data["decision"],"denied")
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.assertEqual(len(mod.AUDIT.read_text().splitlines()),1)
  self.assertEqual(self.deny(item["id"])[0],409)
  self.assertEqual(self.deny("f"*64,1)[0],404)
 def test_reject_synthetic_proposal_forgery(self):
  self.write()
  self.assertEqual(self.deny("invalid")[0],400)
  self.assertEqual(mod.deny({"action":"approve","id":"a"*64,
     "revision":0,"human_confirmed":True},self.sd,self.links)[0],400)
  self.assertFalse(mod.REJECTED.exists())
 def test_symlink_denial_state_fails_closed(self):
  self.write()
  other=Path(self.tmp.name)/"external.txt";other.write_text("protected")
  mod.REJECTED.symlink_to(other)
  with self.assertRaises(ValueError):mod.report(self.sd,self.links)
  self.assertEqual(other.read_text(),"protected")

if __name__=="__main__":unittest.main(verbosity=2)
