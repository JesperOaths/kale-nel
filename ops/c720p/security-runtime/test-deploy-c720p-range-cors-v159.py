#!/usr/bin/env python3
"""No-device tests: add only a nonsecret CORS exposure after old auth gate."""
import hashlib,importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
SRC=ROOT/"deploy-c720p-range-cors-v159.py"
spec=importlib.util.spec_from_file_location("cors_v159",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
 return ("""
class H:
 def origin_ok(self):return True
 def cors(self):
  o=self.headers.get('Origin','')
  if self.origin_ok():self.send_header('Access-Control-Allow-Origin',o);self.send_header('Vary','Origin')
 def authorized(self):return False
 def go(self):
  if not self.authorized(): return self.empty(401)
  return self.archive('new','/saved/clip/mock.mp4',False)
""").encode()
class Tests(unittest.TestCase):
 def test_exact_one_header_added_only_on_authorized_origin(self):
  old=fixture()
  changed=m.patch(old,hashlib.sha256(old).hexdigest())
  self.assertNotEqual(old,changed)
  self.assertEqual(changed.decode().replace(m.EXTRA,""),old.decode())
  self.assertEqual(changed.count(b"Access-Control-Expose-Headers"),1)
  self.assertEqual(changed.count(b"Access-Control-Allow-Origin"),1)
  self.assertEqual(changed.count(b"if self.origin_ok()"),1)
  self.assertIn(b"if not self.authorized(): return self.empty(401)",changed)
  self.assertNotIn(b"Authorization,Content-Range",changed)
  self.assertNotIn(b"Access-Control-Allow-Origin','*'",changed)
 def test_unrecognized_or_already_patched_version_refused(self):
  blob=fixture()
  with self.assertRaisesRegex(RuntimeError,"unexpected_newer_relay_source"):
   m.patch(blob,"0"*64)
  added=m.patch(blob,hashlib.sha256(blob).hexdigest())
  with self.assertRaises(RuntimeError):
   m.patch(added,hashlib.sha256(added).hexdigest())
 def test_missing_origin_gate_refused(self):
  blob=fixture().replace(b"if self.origin_ok()",b"if True")
  with self.assertRaisesRegex(RuntimeError,"authenticated_cors_source_contract_changed"):
   m.patch(blob,hashlib.sha256(blob).hexdigest())
 def test_loopback_restart_waits_only_for_connection_refused(self):
  import urllib.error
  from unittest.mock import patch
  transient=urllib.error.URLError(ConnectionRefusedError(111,"Connection refused"))
  with patch.object(m,"origin_header",side_effect=[transient,transient,True]) as probe,patch.object(m.time,"sleep") as sleep:
   self.assertTrue(m.wait_for_local_relay())
   self.assertEqual(probe.call_count,3)
   self.assertEqual(sleep.call_count,2)
 def test_auth_header_failures_never_retry(self):
  from unittest.mock import patch
  with patch.object(m,"origin_header",side_effect=RuntimeError("existing_allowlisted_origin_not_preserved")) as probe,patch.object(m.time,"sleep") as sleep:
   with self.assertRaisesRegex(RuntimeError,"existing_allowlisted_origin_not_preserved"):
    m.wait_for_local_relay()
   self.assertEqual(probe.call_count,1)
   sleep.assert_not_called()
 def test_other_network_failures_are_not_masked(self):
  import urllib.error
  from unittest.mock import patch
  error=urllib.error.URLError(PermissionError("policy denied"))
  with patch.object(m,"origin_header",side_effect=error),patch.object(m.time,"sleep") as sleep:
   with self.assertRaises(urllib.error.URLError):m.wait_for_local_relay()
   sleep.assert_not_called()
 def test_wait_timeout_still_fails_closed(self):
  import urllib.error
  from unittest.mock import patch
  error=urllib.error.URLError(ConnectionRefusedError(111,"refused"))
  with patch.object(m,"origin_header",side_effect=error) as probe,patch.object(m.time,"sleep") as sleep:
   with self.assertRaisesRegex(RuntimeError,"relay_listener_not_ready_after_restart"):
    m.wait_for_local_relay()
   self.assertEqual(probe.call_count,30)
   self.assertEqual(sleep.call_count,29)
 def test_no_media_mutation_or_auth_changes_in_source(self):
  src=SRC.read_text()
  for banned in ("pm install","am force-stop","adb push","delete_original",
    "review_decide","shutil.rmtree(","copyfile(","/Security4K/motion_",
    "Access-Control-Allow-Origin','*'"):
   self.assertNotIn(banned,src)
  for marker in ("C720P_CONTENT_RANGE_CORS_V159_VERIFIED","OLD_SHA",
      "def origin_header():","def browser():","browser_content_range_not_exposed",
      "atomic(TARGET,old,mode)","unit(\"restart\")",
      "local_c720p_mp4s_preserved","manual_reviews_modified"):
   self.assertIn(marker,src)
if __name__=="__main__":unittest.main(verbosity=2)
