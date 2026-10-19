#!/usr/bin/env python3
"""No-phone regression: scheduled HSV32 attempts must never replay a stale job."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[4]
WORKFLOW=ROOT/".github/workflows/s9-v3-hsv-two-v102.yml"
GATE=Path(__file__).resolve().with_name("run-s9-v3-hsv-two-v102.py")
PATTERN=re.compile(r'^\s*idem="(s9-v3-two-hsv-[^"]+)"',re.MULTILINE)

def key(sha,run_id,attempt):
 text=WORKFLOW.read_text()
 match=PATTERN.search(text)
 if not match:raise ValueError("idempotency expression missing")
 expr=match.group(1)
 if not re.fullmatch("[a-f0-9]{40}",sha) or not str(run_id).isdigit() or not str(attempt).isdigit():
  raise ValueError("invalid synthetic run")
 expr=expr.replace("${GITHUB_SHA:0:20}",sha[:20])
 expr=expr.replace("${GITHUB_RUN_ID}",str(run_id))
 expr=expr.replace("${GITHUB_RUN_ATTEMPT}",str(attempt))
 if "${" in expr:raise ValueError("unresolved shell variable")
 return expr

class UniqueScheduleKeys(unittest.TestCase):
 def test_each_scheduled_run_has_new_key(self):
  same_sha="a"*40
  earlier=key(same_sha,39264486707,1)
  later=key(same_sha,39264486708,1)
  self.assertNotEqual(earlier,later)
  self.assertEqual(earlier,key(same_sha,39264486707,1))
  self.assertNotEqual(later,key(same_sha,39264486708,2))
  self.assertLessEqual(len(later),128)

 def test_scheduler_and_thermal_gate_unchanged(self):
  workflow=WORKFLOW.read_text()
  self.assertIn("cron: '20 1,5,9,13,17,21 * * *'",workflow)
  self.assertIn("cancel-in-progress: false",workflow)
  self.assertIn("s9-v3-two-hsv-real-phone-guarded",workflow)
  self.assertIn("S9_V3_HSV32_TWO_DEFERRED",workflow)
  self.assertIn('"verified_batch_completed": false',workflow)
  self.assertIn("GITHUB_RUN_ID",workflow)
  s=GATE.read_text()
  self.assertIn("INITIAL_MAX_C=39.5",s)
  self.assertIn("missing[:2]",s)
  self.assertIn("fcntl.flock",s)

if __name__=="__main__":unittest.main(verbosity=2)
