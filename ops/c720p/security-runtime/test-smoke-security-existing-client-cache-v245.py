#!/usr/bin/env python3
"""Host-only strict schema and non-mutating real-browser cache acceptance tests."""
import ast
from pathlib import Path
import importlib.util
import unittest
PATH=Path(__file__).with_name("smoke-security-existing-client-cache-v245.py")
spec=importlib.util.spec_from_file_location("security_cache_v245",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def good():
 return {"ok":True,"controlled_release_change":True,
  "original_client_open_first":True,"same_iframe_refreshed":True,
  "actual_versioned_script_network_resources":2,"resource_sha256_equal":True,
  "html_document_replaced":True,"people_controls_retained_after_refresh":True,
  "versioned_asset_bytes_verified":True,"source_html_was_real_served_html":True,
  "no_real_release_deployed":True,"media_and_reviews_unchanged":True,
  "camera_services_untouched":True,"private_names_not_returned":True,
  "token_or_signed_url_not_returned":True}
class Tests(unittest.TestCase):
 def test_accept_only_two_versioned_network_resources_and_real_reload(self):
  self.assertTrue(m.validate(good())["same_existing_iframe_client_refreshed"])
  for key,value in [("actual_versioned_script_network_resources",1),
   ("same_iframe_refreshed",False),("people_controls_retained_after_refresh",False),
   ("resource_sha256_equal",False),("no_real_release_deployed",False),
   ("media_and_reviews_unchanged",False),("token_or_signed_url_not_returned",False)]:
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,"cache_browser_v245_unverified_fields"):
    m.validate({**good(),key:value})
 def test_never_writes_browser_production_or_records(self):
  js=m.js()
  for required in ("iframe.srcdoc=newTag(value)","crypto.subtle.digest('SHA-256'",
       "getEntriesByType('resource')","doc.querySelectorAll('button')",
       "finally{iframe.remove();}","actual_versioned_script_network_resources:2"):
   self.assertIn(required,js)
  for forbidden in ("saveClip(", "deleteClip(", "assign_many",
    "pm install","camera2.stop","FileInputStream(","fetch('/new/api/s9-manual-recording-links'"):
   self.assertNotIn(forbidden,js)
  src=PATH.read_text()
  tree=ast.parse(src)
  actual=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call)
      and isinstance(n.func,ast.Attribute)]
  for forbidden in ("write_text","write_bytes","unlink","replace","Popen","system","chmod","rmtree"):
   self.assertNotIn(forbidden,actual)
 def test_untrusted_failure_does_not_leak_signed_url(self):
  with self.assertRaisesRegex(RuntimeError,"cache_browser_v245_unknown"):
   m.validate({"ok":False,"reason":"https://signed.private.example"})
if __name__=="__main__":unittest.main(verbosity=2)
