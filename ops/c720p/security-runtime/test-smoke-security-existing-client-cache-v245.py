#!/usr/bin/env python3
import ast,importlib.util
from pathlib import Path
import unittest
SOURCE=Path(__file__).with_name("smoke-security-existing-client-cache-v245.py")
spec=importlib.util.spec_from_file_location("security_existing_client_v245",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class T(unittest.TestCase):
 def good(self):return {"ok":True,"existing_client_remained_open":True,
    "controlled_version_transition":True,
    "changed_js_query_and_fetched_new_asset":True,
    "served_old_new_sha256_equal":True,
    "before_after_security_controls_present":True,
    "stylesheets_rendered_before_after":True,
    "updated_js_resource_request_count":1,
    "actual_css_stylesheet_count":1,
    "no_review_or_media_changes":True,
    "automatic_remote_release_detection_not_claimed":True}
 def test_strict_measured_result(self):
  self.assertTrue(m.validate(self.good())["js_reloaded_with_new_v_query"])
  for k,val in (("existing_client_remained_open",False),
    ("actual_css_stylesheet_count",0),
    ("updated_js_resource_request_count",0),
    ("served_old_new_sha256_equal",False)):
   with self.subTest(k=k),self.assertRaises(RuntimeError):
    m.validate({**self.good(),k:val})
  with self.assertRaises(RuntimeError):m.validate({"ok":False,"reason":"privateurl"})
 def test_browser_no_release_or_review_mutation(self):
  js=m.js()
  for required in ("crypto.subtle.digest","iframe.srcdoc=content",
     "performance.getEntriesByType('resource')",
     "stylesheets_rendered_before_after:true",
     "automatic_remote_release_detection_not_claimed:true"):
   self.assertIn(required,js)
  for forbidden in ("deleteClip(","saveClip(","/new/api/s9-manual-recording-links",
     "window.location.reload(", "document.cookie=","getUserMedia("):
   self.assertNotIn(forbidden,js)
  tree=ast.parse(SOURCE.read_text())
  calls=[n.func.attr for n in ast.walk(tree) if
       isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
  for forbidden in ("write_bytes","write_text","unlink","chmod",
    "Popen","system","restart"):
   self.assertNotIn(forbidden,calls)
if __name__=="__main__":unittest.main(verbosity=2)
