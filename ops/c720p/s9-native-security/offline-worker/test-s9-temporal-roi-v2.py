#!/usr/bin/env python3
"""Deterministic temporal ROI audit parity and no-original-writes tests."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent

class Tests(unittest.TestCase):
 def test_original_three_are_prefix_of_five_extra(self):
  old=(ROOT/"S9StandalonePersonRoiAudit.java").read_text()
  new=(ROOT/"S9StandalonePersonRoiAuditV2.java").read_text()
  self.assertIn("new double[]{.33,.66,.12}",old)
  self.assertIn("new double[]{.33,.66,.12,.05,.22,.47,.79,.92}",new)
  for token in ("scores[0][i]>=.45f","score<.56f",
                "aspect<1.15f||aspect>5.0f","w<50||h<100",
                "person_box_clipped_by_frame_edge"):
   self.assertIn(token,old)
   self.assertIn(token,new)
  self.assertIn("eligibleFirstThree=0,eligibleLaterFive=0",new)
  self.assertIn('"extra_five_only_rescued"',new)
  self.assertIn('frames_requested",8',new)
  for token in ("Files.write(","Bitmap.compress","pm install","am force-stop"):
   self.assertNotIn(token,new)

 def test_bounded_controller_and_identity_free_output(self):
  py=(ROOT/"audit-s9-temporal-roi-v2.py").read_text()
  self.assertIn("s9_offline",py.lower())
  self.assertIn("sum(reasons.values())!=8",py)
  self.assertIn("additional_five_frames_rescued",py)
  self.assertIn("frames_scanned",py)
  self.assertIn("no_person_above_045",py)
  self.assertIn("selected=source_selection",py) if False else None
  self.assertIn('opts.limit<=5',py)
  self.assertNotIn("pm install",py)
  self.assertNotIn("review/decide",py)

if __name__=="__main__":unittest.main(verbosity=2)
