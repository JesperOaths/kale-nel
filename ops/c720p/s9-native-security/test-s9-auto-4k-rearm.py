#!/usr/bin/env python3
"""Regression contract for S9+ thermal fallback self-recovery."""
from pathlib import Path
import unittest
SRC=(Path(__file__).resolve().parent/"src/nl/kalenel/s9security/CameraService.java").read_text()
class Recovery(unittest.TestCase):
 def test_auto_rearm_is_guarded_to_405_tenths_with_headroom(self):
  code=SRC.split("private void maybeRestoreCool4K(){",1)[1].split("private void watchdog(){",1)[0]
  self.assertIn("now<continuous4KRetryAfterMs||temperature()>=405",code)
  self.assertIn('"watching".equals(mode)',code)
  self.assertIn('continuous_4k_production_enabled',code)
  self.assertIn('continuous4KRecoveryAttempts>=3',code)
  self.assertIn('now-lastMovementAt<30000',code)
  self.assertIn('gardenPersonCandidateUntil>now',code)
  self.assertIn('folder.getUsableSpace()<15L*1024*1024*1024',code)
  self.assertNotIn('temperature()>350',code)
 def test_cooldown_and_hot_guard_not_weakened(self):
  self.assertIn('continuous4KRetryAfterMs=SystemClock.elapsedRealtime()+20L*60L*1000L',SRC)
  self.assertIn('boolean tooHot=temperature()>=420;',SRC)
  self.assertIn('continuous4KRecoveryAttempts++;',SRC)
  self.assertIn('d.put("continuous_4k_rearm_temperature_below_c",40.5);',SRC)
  self.assertIn('if(pilotOnly||continuous4KTrial||temperature()>=405',SRC)
if __name__=="__main__":unittest.main(verbosity=2)
