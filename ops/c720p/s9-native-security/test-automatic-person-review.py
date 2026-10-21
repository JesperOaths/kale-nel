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
  for name,filename in (("STATE",""),("SOURCE","suggestions.json"),("REFERENCES","references.json"),("REJECTED","denied.json"),
                        ("LOCK","review.lock"),("AUDIT","denied.audit.jsonl")):
   p=Path(self.tmp.name)/filename if filename else Path(self.tmp.name)
   patcher=patch.object(mod,name,p);patcher.start();self.addCleanup(patcher.stop)
  self.sd={CLIP:{"sd_verified":True}}
  self.reference_names=["motion_1792200100000.mp4","motion_1792200200000.mp4"]
  self.links={"sd:"+name:{"folder":FOLDER,"folders":[FOLDER],
    "review_status":"assigned"} for name in self.reference_names}
  self.reference_ids=["1"*64,"2"*64]
  self.write_reference_index()
 def write_reference_index(self,model=MODEL,revoked=(),generation=1):
  entries=[]
  for pos,id in enumerate(self.reference_ids):
   entries.append({"id":id,"folder":FOLDER,"source_name":self.reference_names[pos],
      "original_sha256":chr(ord("a")+pos)*64,"human_decision_sha256":"f"*64,
      "model_sha256":model,"human_approved":True,
      "aligned_face":True,"quality_passed":True,"active":id not in revoked})
  mod.REFERENCES.write_text(json.dumps({
    "schema":"s9_qualified_face_references_v1",
    "generation":generation,"model_sha256":model,"references":entries}))
 def write(self,**overrides):
  row={"source":"sd","name":CLIP,"folder":FOLDER,
       "snapshot_sha256":SHA,"model_sha256":MODEL,
       "aligned_face":True,"human_confirmed_reference":True,
       "pair_score_origin":"s9_local_exact_face_pair_score_v1",
       "reference_count":2,"reference_ids":self.reference_ids,"score":.94,"margin":.11}
  row.update(overrides)
  mod.SOURCE.write_text(json.dumps({"version":1,
   "origin":"s9_offline_aligned_face_embeddings","model_sha256":MODEL,"reference_generation":1,
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
 def test_manual_group_and_terminal_review_decisions_do_not_resurface(self):
  self.write()
  for entry in (
      {"folder":"G888","folders":["G888","G123"],"review_status":"assigned"},
      {"folder":None,"folders":["G888"],"review_status":"assigned"},
      {"folder":None,"folders":[],"review_status":"skipped"},
      {"folder":None,"folders":[],"review_status":"rejected"},
      {"folder":None,"folders":[],"review_status":"unknown"},
      {"folder":"G888"}):
   with self.subTest(entry=entry):
    self.links["sd:"+CLIP]=entry
    self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.links["sd:"+CLIP]={"folder":None,"folders":[],"review_status":"inbox"}
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)

 def test_denied_pair_stays_denied_after_model_and_crop_refresh(self):
  self.write()
  first=mod.report(self.sd,self.links)["items"][0]
  self.assertEqual(self.deny(first["id"])[0],200)
  self.assertEqual(len(mod.state()["denied_pairs"]),1)
  doc=json.loads(mod.SOURCE.read_text())
  doc["model_sha256"]="c"*64
  doc["suggestions"][0]["model_sha256"]="c"*64
  doc["suggestions"][0]["snapshot_sha256"]="d"*64
  mod.SOURCE.write_text(json.dumps(doc))
  self.write_reference_index(model="c"*64)
  refreshed,status=mod.proposals(self.links)
  self.assertEqual(status,"ready")
  self.assertNotEqual(refreshed[0]["id"],first["id"])
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])

 def test_revoked_reference_disappears_without_resetting_manual_decision(self):
  self.write()
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)
  self.write_reference_index(revoked=(self.reference_ids[0],))
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.assertEqual(mod.proposals()[1],"ready")
  self.assertFalse(mod.REJECTED.exists())
  self.write_reference_index(generation=2)
  with self.assertRaises(ValueError):mod.proposals()
 def test_two_distinct_face_ids_from_one_original_do_not_qualify(self):
  self.write()
  registry=json.loads(mod.REFERENCES.read_text())
  registry["references"][1]["source_name"]=registry["references"][0]["source_name"]
  mod.REFERENCES.write_text(json.dumps(registry))
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.assertEqual(mod.proposals(self.links)[1],"ready")

 def test_same_original_bytes_under_two_filenames_cannot_count_twice(self):
  self.write()
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)
  registry=json.loads(mod.REFERENCES.read_text())
  self.assertNotEqual(registry["references"][0]["original_sha256"],
                      registry["references"][1]["original_sha256"])
  registry["references"][1]["original_sha256"]=registry["references"][0]["original_sha256"]
  mod.REFERENCES.write_text(json.dumps(registry))
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.assertEqual(mod.proposals(self.links)[1],"ready")
  self.assertFalse(mod.REJECTED.exists())

 def test_target_clip_cannot_act_as_its_own_identity_reference(self):
  self.write()
  registry=json.loads(mod.REFERENCES.read_text())
  registry["references"][0]["source_name"]=CLIP
  mod.REFERENCES.write_text(json.dumps(registry))
  self.links["sd:"+CLIP]={"folder":FOLDER,"folders":[FOLDER],"review_status":"assigned"}
  rows,status=mod.proposals(self.links)
  self.assertEqual(status,"ready")
  self.assertEqual(rows,[])
  self.assertFalse(mod.REJECTED.exists())

 def test_latest_manual_skip_or_group_revokes_source_reference(self):
  self.write()
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)
  src="sd:"+self.reference_names[0]
  self.links[src]={"folder":None,"folders":[],"review_status":"skipped"}
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.links[src]={"folder":FOLDER,"folders":[FOLDER,"G999"],
                   "review_status":"assigned"}
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.links[src]={"folder":"G999","folders":["G999"],
                   "review_status":"assigned"}
  self.assertEqual(mod.report(self.sd,self.links)["items"],[])
  self.assertFalse(mod.REJECTED.exists())
  self.links[src]={"folder":FOLDER,"folders":[FOLDER],
                   "review_status":"assigned"}
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)

 def test_missing_reference_index_denies_all_proposals(self):
  self.write()
  mod.REFERENCES.unlink()
  rows,status=mod.proposals()
  self.assertEqual(rows,[])
  self.assertEqual(status,"qualified_face_reference_index_not_ready")
 def test_duplicate_reference_id_rejected(self):
  self.write()
  registry=json.loads(mod.REFERENCES.read_text())
  registry["references"][1]["id"]=registry["references"][0]["id"]
  mod.REFERENCES.write_text(json.dumps(registry))
  with self.assertRaises(ValueError):mod.proposals()
 def test_existing_denial_registry_remains_compatible(self):
  self.write()
  mod.REJECTED.write_text(json.dumps({"version":1,"revision":1,"denied":[]}))
  self.assertEqual(len(mod.report(self.sd,self.links)["items"]),1)
  self.assertEqual(mod.state()["denied_pairs"],[])

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
