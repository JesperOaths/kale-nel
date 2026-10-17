#!/usr/bin/env python3
"""No network: S9 live night visibility install patch and source-safety checks."""
import importlib.util
from pathlib import Path
import unittest
BASE=Path(__file__).resolve().parent
P=BASE/"deploy-s9-night-visibility-v1.py"
SCRIPT=BASE/"s9-night-visibility-v1.js"
spec=importlib.util.spec_from_file_location("night_ui",P)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
HTML='''<html><head><script src="/local/c720p-secure-relay-client.js"></script><script src="/local/frontyard-security-new/security-hub-v30.js"></script></head><body><section id="panel-live"><img id="cameraLive"><dl id="liveDiagnostics"></dl></section></body></html>'''

class NightVisibilityPatch(unittest.TestCase):
 def test_idempotent_live_page_injection(self):
  rev="f"*40
  changed=mod.patch(HTML,rev)
  self.assertIn('id="s9-night-visibility-v1"',changed)
  self.assertIn('/local/frontyard-security-new/s9-night-visibility-v1.js?v=ffffffffffff',changed)
  self.assertEqual(changed,mod.patch(changed,rev))
  self.assertEqual(changed.count("</body>"),1)

 def test_unknown_security_page_rejected(self):
  for invalid in ("<html><body></body></html>",
    HTML.replace('id="cameraLive"','id="cameraNone"'),
    HTML.replace("/local/c720p-secure-relay-client.js","/local/insecure.js")):
   with self.assertRaises(RuntimeError):mod.patch(invalid,"a"*40)

 def test_no_camera_mutations_or_original_rewrite(self):
  deployment=P.read_text()
  js=SCRIPT.read_text()
  self.assertIn("S9_NIGHT_VISIBILITY_V1_APPLIED",deployment)
  self.assertIn("S9_NIGHT_VISIBILITY_V1_ROLLBACK_ATTEMPTED",deployment)
  self.assertIn("original_archive_count",deployment)
  self.assertIn("night_active",js)
  self.assertIn("result.night_active",js)
  self.assertIn('j.get("night_active")',deployment)
  self.assertIn("brightness(",js)
  self.assertIn("cameraLive",js)
  self.assertIn("/new/camera-controls",js)
  self.assertNotIn("window.localStorage",js)
  # Only the newly created enhancement JS may be deleted during rollback.
  self.assertIn('if old is None:p.unlink(missing_ok=True)',deployment)
  for banned in ("adb install","am force-stop","DELETE ","shutil.rmtree("):
   self.assertNotIn(banned,deployment)
  for banned in ("fetch('/new/camera-control',","XMLHttpRequest","MediaRecorder","canvas.toDataURL",
     "URL.createObjectURL","document.cookie"):
   self.assertNotIn(banned,js)

if __name__=="__main__":
 unittest.main()
