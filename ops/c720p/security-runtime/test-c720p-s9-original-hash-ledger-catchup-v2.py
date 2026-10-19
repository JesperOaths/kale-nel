#!/usr/bin/env python3
"""Protect the S9 integrity catch-up cadence without changing hashing behavior."""
from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parent
CFG=ROOT/"c720p-s9-original-hash-ledger-catchup-v2.conf"
HASH=ROOT/"s9-original-hash-ledger-v1.py"
class Safety(unittest.TestCase):
 def test_timer_only_changes_rate(self):
  s=CFG.read_text()
  self.assertIn("OnUnitInactiveSec=5min",s)
  self.assertIn("RandomizedDelaySec=90s",s)
  self.assertIn("AccuracySec=1min",s)
  self.assertEqual(s.count("[Timer]"),1)
  self.assertNotIn("[Service]",s)
  for x in ("ExecStart=","Unit=","OnBootSec=","Persistent=","OnCalendar=","OnActiveSec="):
   self.assertNotIn(x,s)
 def test_hash_worker_single_clip_and_lock(self):
  s=HASH.read_text()
  self.assertIn('pick=choose(snapshot,ledger["checks"],moment)',s)
  self.assertIn('name,entry=pick',s)
  self.assertIn('fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)',s)
  self.assertIn('matched=phone_audit(name,entry)',s)
  self.assertIn('"automatic_quarantine":False',s)
 def test_original_hash_android_capture_gate_not_weakened(self):
  phone=(ROOT.parent/"s9-native-security/offline-worker/PhoneArchiveIntegrityCli.java").read_text()
  self.assertIn('temp>=0&&temp<39.0',phone)
  self.assertIn('"watching".equals(status.optString("mode"))',phone)
  self.assertIn('continuous_4k_dropped_output_frames',phone)
  self.assertIn('getUsableSpace()<20L*1024*1024*1024',phone)
if __name__=="__main__":unittest.main(verbosity=2)
