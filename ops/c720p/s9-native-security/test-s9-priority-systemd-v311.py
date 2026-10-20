#!/usr/bin/env python3
"""Host-only contract: low duty schedule never touches Camera2 or reviews."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent/"systemd"
class Units(unittest.TestCase):
 def test_original_rescan_single_worker_limits(self):
  s=(ROOT/"c720p-s9-priority-rescan-v304.service").read_text()
  for x in ("Type=oneshot","CPUQuota=25%","MemoryMax=640M",
    "MemoryHigh=520M","Nice=19","IOSchedulingClass=idle",
    "TimeoutStartSec=215","UMask=0077","NoNewPrivileges=true",
    "s9_priority_rescan_feedback_v304.py work"):
   self.assertIn(x,s)
  for bad in ("CameraService","systemctl restart","adb install",
      "rm -rf","--skip-camera-guard","--force-reprocess"):
   self.assertNotIn(bad,s)
 def test_timer_cannot_hammer_camera(self):
  t=(ROOT/"c720p-s9-priority-rescan-v304.timer").read_text()
  self.assertIn("OnUnitInactiveSec=45min",t)
  self.assertIn("RandomizedDelaySec=5min",t)
  self.assertIn("Persistent=false",t)
  self.assertNotIn("OnUnitInactiveSec=1min",t)
 def test_priorities_metadata_separate_and_no_auto_filing(self):
  p=(ROOT/"c720p-s9-priority-producer-v304.service").read_text()
  self.assertIn("s9_priority_rescan_feedback_v304.py produce",p)
  self.assertIn("MemoryMax=160M",p)
  self.assertNotIn("face_person_review",p)
  self.assertIn("OnUnitInactiveSec=20min",
      (ROOT/"c720p-s9-priority-producer-v304.timer").read_text())
if __name__=="__main__":unittest.main(verbosity=2)
