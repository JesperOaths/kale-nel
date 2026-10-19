#!/usr/bin/env python3
"""Ensure source-verified V3 work progresses in one safe four-hour window.

The six existing windows/day are unchanged. This test only validates that
OSNet precedes HSV32, which precedes immutable V3 ranking publication.
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[4]
WORK=ROOT/".github/workflows"
HOURS="1,5,9,13,17,21"
FILES={
 "osnet":"s9-v3-single-orphan-osnet-v113.yml",
 "hsv32":"s9-v3-hsv-two-v102.yml",
 "rank":"s9-v3-progressive-ranking-v113.yml",
}
SCRIPTS={
 "osnet":"run-s9-v3-single-orphan-osnet-v113.py",
 "hsv32":"run-s9-v3-hsv-two-v102.py",
 "rank":"run-s9-uniform-appearance-rankings-v3.py",
}

def schedule(text):
    matches=re.findall(r"(?m)^\s+- cron: '(\d+) ([^']+) \* \* \*'\s*$",text)
    if len(matches)!=1:
        raise ValueError("Each flow must have one bounded cron expression")
    minute,hours=matches[0]
    if hours!=HOURS or not 0<=int(minute)<60:
        raise ValueError("Unexpected schedule frequency")
    return int(minute)

class CoolWindowOrder(unittest.TestCase):
    def setUp(self):
        self.contents={k:(WORK/v).read_text() for k,v in FILES.items()}

    def test_order_and_same_six_existing_windows(self):
        times={name:schedule(text) for name,text in self.contents.items()}
        self.assertEqual(times,{"osnet":5,"hsv32":20,"rank":40})
        self.assertGreaterEqual(times["hsv32"]-times["osnet"],15)
        self.assertGreaterEqual(times["rank"]-times["hsv32"],15)

    def test_each_stage_is_idempotent_and_serialized(self):
        for name,source in self.contents.items():
            with self.subTest(name=name):
                self.assertIn("cancel-in-progress: false",source)
                self.assertIn("github.event_name == 'schedule'",source)
                self.assertIn("GITHUB_RUN_ID",source)
                self.assertIn("needs: verify",source)
                self.assertIn("github.repository == 'JesperOaths/kale-nel'",source)

    def test_no_capture_or_source_integrity_guard_removed(self):
        d=Path(__file__).resolve().parent
        for name,script in SCRIPTS.items():
            code=(d/script).read_text()
            with self.subTest(stage=name):
                self.assertIn("fcntl.flock",code)
                if name!="rank":
                    self.assertIn("39.5",code)
                self.assertIn("capture_",code)
        rank=(d/SCRIPTS["rank"]).read_text()
        self.assertIn("verified_v2_baseline(rows)",rank)
        self.assertIn("publish_verified_active(",rank)

if __name__=="__main__":
    unittest.main(verbosity=2)
