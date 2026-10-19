#!/usr/bin/env python3
"""Offline safeguards for aggregate no-image S9 person-ROI diagnostics."""
import importlib.util
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
FILE=ROOT/"audit-s9-roi-rejection-reasons-v1.py"
spec=importlib.util.spec_from_file_location("audit_s9_roi",FILE)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
 def test_distinct_no_image_rejection_categories(self):
  java=(ROOT/"S9StandalonePersonRoiAudit.java").read_text()
  original=(ROOT/"S9StandalonePersonRoi.java").read_text()
  for word in ("no_person_above_045","multiple_people_above_045",
               "person_confidence_045_to_056",
               "person_box_clipped_by_frame_edge","person_box_too_small",
               "person_box_aspect_invalid","person_box_area_too_small",
               "video_frame_unavailable","eligible_single_full_person"):
   self.assertIn(word,java)
   self.assertIn(word,mod.REASONS)
  for word in ("new double[]{.33,.66,.12}","scores[0][i]>=.45f",
               "score<.56f","aspect<1.15f","aspect>5.0f", "w<50||h<100"):
   self.assertIn(word,java)
   self.assertIn(word,original)
  self.assertIn("crop_images_saved",java)
  self.assertNotIn("Bitmap.compress",java)
  self.assertNotIn("Files.write(",java)
  self.assertNotIn("FileOutputStream(",java)
  self.assertNotIn("pm install",java)
  self.assertNotIn("am force-stop",java)

 def test_selected_mode_and_aborts_on_invalid_response(self):
  value=mod.REASONS
  self.assertEqual(len(value),10)
  self.assertIn("no_person_above_045",value)
  self.assertIn("invalid_person_coordinates",value)
  code=FILE.read_text()
  self.assertIn("sum(reasons.values())!=3",code)
  self.assertIn("set(reasons)-REASONS",code)
  self.assertIn('temperature:\\s*(\\d+)',code)
  self.assertIn("primary_events()",code)
  self.assertIn("candidates(events,approved,mode)",code)

 def test_install_only_is_separate_from_camera(self):
  setup=(ROOT/"install-s9-roi-rejection-audit-v1.py").read_text()
  self.assertIn("s9-offline-person-roi-audit-v1.jar",setup)
  self.assertIn("S9StandalonePersonRoiAudit.java",setup)
  self.assertNotIn("pm install",setup)
  self.assertNotIn("am force-stop",setup)

if __name__=="__main__":unittest.main(verbosity=2)
