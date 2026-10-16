#!/usr/bin/env python3
"""No camera/network access; validate numeric-only night-image quality reporting."""
import importlib.util
from pathlib import Path
import unittest

DIR=Path(__file__).resolve().parent
PATH=DIR/"audit-night-image-quality-v1.py"
spec=importlib.util.spec_from_file_location("s9_night_quality",PATH)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class NightImageQualityTests(unittest.TestCase):
 def test_black_scene_reports_full_dark_fraction(self):
  m=audit.metrics(bytes([0]*14400))
  self.assertEqual(m["p50"],0)
  self.assertEqual(m["dark_fraction"],1)
  self.assertEqual(m["nearblack_fraction"],1)
  self.assertEqual(m["clipped_fraction"],0)
  self.assertEqual(m["local_edge_energy"],0)

 def test_mixed_brightness_and_edge_measurable(self):
  pixels=bytes(220 if ((i%160)//8)%2 else 20 for i in range(14400))
  m=audit.metrics(pixels)
  self.assertEqual(m["p10"],20)
  self.assertEqual(m["p90"],220)
  self.assertGreater(m["local_edge_energy"],0)
  self.assertAlmostEqual(m["dark_fraction"],.5,delta=.001)

 def test_invalid_gray_frame_refused(self):
  with self.assertRaises(RuntimeError):
   audit.metrics(bytes(100))

 def test_no_mutation_or_exfiltration(self):
  text=PATH.read_text()
  self.assertIn("S9_NIGHT_IMAGE_QUALITY_V1",text)
  self.assertIn('"frames_transferred_out":0',text)
  for forbidden in ("DELETE ","PUT ","POST ","adb install","os.remove(",
     "unlink(", "shutil.rmtree(", "base64.b64encode(", "save(", "imwrite("):
   self.assertNotIn(forbidden,text)
  self.assertIn('if snap.get("mode")!="watching"',text)

if __name__=="__main__":
 unittest.main()
