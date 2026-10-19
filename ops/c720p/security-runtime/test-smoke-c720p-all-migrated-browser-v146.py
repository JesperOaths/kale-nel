#!/usr/bin/env python3
"""Synthetic refusal/provenance checks for all-import browser Range proof."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/"smoke-c720p-all-migrated-browser-v146.py"
spec=importlib.util.spec_from_file_location("all_ranges_v146",FILE)
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

def good():
 return {"ok":True,"authenticated_relay":True,"static_assets_served":3,
  "manifest_count":6,"signed_tickets":6,"authenticated_ranges_206":6,
  "each_range_bytes":1024,"no_video_decoded":True,"originals_modified":False,
  "manual_reviews_modified":False,"filenames_not_returned":True,
  "signed_urls_not_returned":True}

class AllBrowserSafety(unittest.TestCase):
 def test_every_manifest_item_required(self):
  self.assertEqual(s.validate(good())["ranges_206"],6)
  for changed in ({"authenticated_ranges_206":5},{"signed_tickets":5},
     {"manifest_count":0},{"manifest_count":5001},{"static_assets_served":2},
     {"ok":False},{"authenticated_relay":False},
     {"each_range_bytes":9000},{"no_video_decoded":False},
     {"originals_modified":True},{"manual_reviews_modified":True},
     {"filenames_not_returned":False},{"signed_urls_not_returned":False}):
    item=good();item.update(changed)
    with self.subTest(change=changed),self.assertRaises(RuntimeError):
     s.validate(item)

 def test_range_bounded_before_read_and_no_ids_returned(self):
  js=s.script()
  self.assertIn("headers:{Range:'bytes=0-1023'}",js)
  self.assertIn("status_206:mp4.status===206",js)
  self.assertIn("length_1024:length===1024",js)
  self.assertIn("range_matches_manifest:range==='bytes 0-1023/'+String(f.bytes)",js)
  self.assertIn("mime_mp4:type==='video/mp4'",js)
  self.assertIn("await mp4.body?.cancel()",js)
  self.assertLess(js.index("length_1024:length===1024"),js.index("await mp4.arrayBuffer()"))
  self.assertIn("seen.has(f.name)",js)
  self.assertIn("passed++",js)
  self.assertNotIn("return {ticket:",js)
  self.assertNotIn("return {clip:",js)
  self.assertNotIn("return {filename:",js)
  self.assertNotIn("v.play(",js)
  self.assertIn("filenames_not_returned:true",js)

 def test_failed_range_returns_only_safe_boolean_contract_flags(self):
  keys=("status_206","length_1024","range_header_visible",
        "range_matches_manifest","mime_mp4")
  report={"ok":False,"reason":"range_contract_failed","passed":2,
          "range_checks":dict(zip(keys,(True,True,False,False,True))),
          "filename":"private-test-clip.mp4",
          "signed_url":"https://secret.invalid/recording?key=hidden"}
  with patch("builtins.print") as printed:
   with self.assertRaisesRegex(RuntimeError,"range_contract_failed"):
    s.validate(report)
  self.assertEqual(printed.call_count,1)
  text=printed.call_args.args[0]
  self.assertIn("C720P_MIGRATED_ALL_RANGE_DIAGNOSTIC ",text)
  self.assertIn('"previous_ranges_verified": 2',text)
  self.assertIn('"range_header_visible": false',text)
  self.assertIn('"status_206": true',text)
  self.assertNotIn("private-test-clip.mp4",text)
  self.assertNotIn("secret.invalid",text)
  self.assertNotIn("key=hidden",text)
  for bad in ({"status_206":"true"},dict(zip(keys,[True]*4+[1]))):
   with patch("builtins.print") as blocked:
    forged=dict(report,range_checks=bad)
    with self.assertRaises(RuntimeError):s.validate(forged)
    blocked.assert_not_called()

 def test_no_private_data_in_failure_codes(self):
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "all_migrated_browser_ranges_not_verified_range_contract_failed")),
   "all_migrated_browser_ranges_not_verified_range_contract_failed")
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "private-name.mp4?ticket=secret-and-identity")),
   "other_no_private_detail")
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "s9_capture_unhealthy_busy_or_hot")), "s9_capture_unhealthy_busy_or_hot")

 def test_existing_browser_worker_and_live_page_unchanged(self):
  src=FILE.read_text()
  for forbidden in ("adb push","pm install","ffmpeg","--delete",
     "unlink(","shutil.rmtree","os.remove","DeleteClip",
     "SaveClip","camera_restart"):
   self.assertNotIn(forbidden,src)
  for required in ("mod.run()","mod.script=script","mod.validate_result=validate",
     "units()","index_regeneration_guard_active","local_copy_retention_required"):
   self.assertIn(required,src)
  with patch.object(s.subprocess,"run",return_value=type("Return",(),{
   "returncode":0,"stdout":"active\n"})()):
   self.assertTrue(s.units())

if __name__=="__main__":unittest.main(verbosity=2)
