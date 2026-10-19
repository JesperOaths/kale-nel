#!/usr/bin/env python3
"""Synthetic refusal/provenance checks for all-import browser Range proof."""
import importlib.util
import hashlib
import json
from email.message import Message
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
  "each_range_bytes":1024,"browser_content_range_exposed_count":0,
  "no_video_decoded":True,"originals_modified":False,
  "manual_reviews_modified":False,"filenames_not_returned":True,
  "signed_urls_not_returned":True}

class AllBrowserSafety(unittest.TestCase):
 def test_every_manifest_item_required(self):
  self.assertEqual(s.validate(good())["ranges_206"],6)
  for changed in ({"authenticated_ranges_206":5},{"signed_tickets":5},
     {"manifest_count":0},{"manifest_count":5001},{"static_assets_served":2},
     {"ok":False},{"authenticated_relay":False},
     {"each_range_bytes":9000},{"browser_content_range_exposed_count":7},
     {"no_video_decoded":False},
     {"originals_modified":True},{"manual_reviews_modified":True},
     {"filenames_not_returned":False},{"signed_urls_not_returned":False}):
    item=good();item.update(changed)
    with self.subTest(change=changed),self.assertRaises(RuntimeError):
     s.validate(item)

 def test_range_bounded_before_read_and_no_ids_returned(self):
  js=s.script()
  self.assertIn("headers:{Range:'bytes=0-1023'}",js)
  self.assertIn("mp4.status!==206?'range_non206'",js)
  self.assertIn("await mp4.body?.cancel()",js)
  self.assertLess(js.index("length!==1024"),js.index("await mp4.arrayBuffer()"))
  self.assertIn("seen.has(f.name)",js)
  self.assertIn("range&&range!==",js)
  self.assertIn("browser_content_range_exposed_count:contentRangeExposed",js)
  for reason in ("range_non206","range_bad_length",
    "range_manifest_total_mismatch","range_bad_mime"):
   self.assertIn(reason,js)
   self.assertEqual(s.safe_failure_reason(RuntimeError(
     "all_migrated_browser_ranges_not_verified_"+reason)),
     "all_migrated_browser_ranges_not_verified_"+reason)
  self.assertIn("passed++",js)
  self.assertNotIn("return {ticket:",js)
  self.assertNotIn("return {clip:",js)
  self.assertNotIn("return {filename:",js)
  self.assertNotIn("v.play(",js)
  self.assertIn("filenames_not_returned:true",js)

 def test_no_private_data_in_failure_codes(self):
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "all_migrated_browser_ranges_not_verified_range_contract_failed")),
   "all_migrated_browser_ranges_not_verified_range_contract_failed")
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "private-name.mp4?ticket=secret-and-identity")),
   "other_no_private_detail")
  self.assertEqual(s.safe_failure_reason(RuntimeError(
   "s9_capture_unhealthy_busy_or_hot")), "s9_capture_unhealthy_busy_or_hot")

 def test_all_host_ranges_headers_and_sha(self):
  def response(port,route,limit,headers=None):
   h=Message()
   if headers is None:
    h["Content-Type"]="application/json"
    doc={"ok":True,"schema_version":s.HOST_SCHEMA,
      "not_s9_original_recordings":True,"not_person_assignments":True,
      "total_imported":6,"files":[{"name":"example"+str(i)+".mp4","bytes":12000+i,
        "indexed":True} for i in range(6)]}
    return 200,h,json.dumps(doc).encode()
   name=route.rsplit("/",1)[-1]
   index=int(name.replace("example","").replace(".mp4",""))
   h["Content-Type"]="video/mp4"
   h["Content-Length"]="1024"
   h["Content-Range"]="bytes 0-1023/"+str(12000+index)
   return 206,h,b"a"*1024
  with patch.object(s,"host_fetch",side_effect=response):
   summary=s.host_range_all()
  self.assertEqual(summary["verified_count"],6)
  self.assertTrue(summary["upstream_front_ranges_sha_equal"])

 def test_all_host_ranges_fail_on_bad_headers_or_bytes(self):
  def fixture(port,route,limit,headers=None):
   h=Message()
   if headers is None:
    h["Content-Type"]="application/json"
    doc={"ok":True,"schema_version":s.HOST_SCHEMA,
      "not_s9_original_recordings":True,"not_person_assignments":True,
      "total_imported":6,"files":[{"name":"example"+str(i)+".mp4","bytes":12000,
        "indexed":True} for i in range(6)]}
    return 200,h,json.dumps(doc).encode()
   h["Content-Type"]="video/mp4"
   h["Content-Length"]="1024"
   h["Content-Range"]="bytes 0-1023/12000"
   return 206,h,(b"x"*1024 if port==8795 else b"y"*1024)
  with patch.object(s,"host_fetch",side_effect=fixture):
   with self.assertRaisesRegex(RuntimeError,"host_range_bytes_disagree"):
    s.host_range_all()
  def corrupt_header(port,route,limit,headers=None):
   status,h,body=fixture(port,route,limit,headers)
   if headers is not None:h.replace_header("Content-Range","bytes 0-1023/11999")
   return status,h,body
  with patch.object(s,"host_fetch",side_effect=corrupt_header):
   with self.assertRaisesRegex(RuntimeError,"host_range_header_or_length_mismatch"):
    s.host_range_all()

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
