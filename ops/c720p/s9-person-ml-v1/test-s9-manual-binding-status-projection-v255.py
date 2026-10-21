#!/usr/bin/env python3
"""Synthetic read-path binding projection. Preserve group/returns and history."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

FILE=Path(__file__).with_name("s9_manual_recording_links.py")
spec=importlib.util.spec_from_file_location("task21_v255_read",FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def fixtures(self):
  return {"version":1,"revision":44,"items":{
    "sd:motion_1792100000000.mp4":{"source":"sd","name":"motion_1792100000000.mp4",
      "folder":"PersonA","folders":["PersonA","PersonB"],"review_status":"assigned"},
    "drive:historical_review.mp4":{"source":"drive","name":"historical_review.mp4",
      "folder":None,"folders":[],"review_status":"inbox"},
    "sd:motion_1792100000001.mp4":{"source":"sd","name":"motion_1792100000001.mp4",
      "folder":"PersonB","folders":["PersonB"],"review_status":"assigned",
      "media_binding":{"status":"bound_at_decision","sha256":"a"*64,
       "source":"sd","source_identity":"sd:abc","source_revision":"original-v12"}}
    }}
 def test_historical_and_unavailable_preserve_manual_authority(self):
  doc=self.fixtures()
  with patch.object(m,"current",return_value=doc):
   response=m.report()
  self.assertEqual(response["revision"],44)
  self.assertEqual(response["manual_digest_status"]["counts"],
      {"bound":0,"historically_unbound":2,"source_unavailable":1,
       "revision_mismatch":0})
  original=response["items"]["sd:motion_1792100000000.mp4"]
  self.assertEqual(original["folders"],["PersonA","PersonB"])
  self.assertEqual(original["review_status"],"assigned")
  self.assertEqual(response["items"]["drive:historical_review.mp4"]["review_status"],
    "inbox")
  for item in response["items"].values():
   self.assertNotIn("media_binding",item)
  self.assertEqual(doc["items"]["sd:motion_1792100000001.mp4"][
    "media_binding"]["sha256"],"a"*64)
 def test_revision_mismatch_does_not_demote_any_folder_or_force_review(self):
  doc=self.fixtures()
  verifier=type("V",(),{"display_status":staticmethod(lambda entry,attestor:
           "revision_mismatch")})()
  with patch.object(m,"current",return_value=doc),patch.object(
     m,"binding_protocol",return_value=verifier):
   report=m.report(attestor=object())
  self.assertEqual(report["manual_digest_status"]["counts"]["revision_mismatch"],1)
  item=report["items"]["sd:motion_1792100000001.mp4"]
  self.assertEqual(item["folder"],"PersonB")
  self.assertEqual(item["folders"],["PersonB"])
  self.assertEqual(item["review_status"],"assigned")
  self.assertTrue(report["manual_digest_status"]["historical_authority_preserved"])
  self.assertFalse(report["manual_digest_status"]["reviews_reopened"])
 def test_bound_status_keeps_original_folder_list(self):
  doc=self.fixtures()
  verifier=type("V",(),{"display_status":staticmethod(lambda entry,attestor:
            "bound")})()
  with patch.object(m,"current",return_value=doc),patch.object(
     m,"binding_protocol",return_value=verifier):
   report=m.report(attestor=object())
  self.assertEqual(report["manual_digest_status"]["counts"]["bound"],1)
  self.assertEqual(report["items"]["sd:motion_1792100000001.mp4"]["folders"],
                   ["PersonB"])
 def test_invalid_status_or_entry_refuses_without_publishing(self):
  doc=self.fixtures()
  verifier=type("V",(),{"display_status":staticmethod(lambda *_:"unexpected")})()
  with patch.object(m,"current",return_value=doc),patch.object(
     m,"binding_protocol",return_value=verifier):
   with self.assertRaisesRegex(RuntimeError,"untrusted_binding_state"):
    m.report(attestor=object())
 def test_no_review_write_or_person_change_added_to_get(self):
  s=FILE.read_text()
  self.assertIn('report(attestor=attestor)',s)
  self.assertIn('"historically_unbound"',s)
  self.assertIn('"media_binding_status"',s)
  self.assertIn('if field!="media_binding"',s)
  self.assertIn('"historical_authority_preserved":True',s)
if __name__=="__main__":unittest.main(verbosity=2)
