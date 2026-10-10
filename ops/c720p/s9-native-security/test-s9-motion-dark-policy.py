#!/usr/bin/env python3
"""Conservative MotionGrid sensitivity & recording-rate regression contracts."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parent
SRC=ROOT/'src/nl/kalenel/s9security'

class Tests(unittest.TestCase):
    def test_lowluma_moderate_sensitivity_with_hard_flicker_guards(self):
        code=(SRC/'MotionGrid.java').read_text()
        self.assertIn('(lighting<42?23.0f:18.5f)',code)
        self.assertIn('votes.size()>7',code)
        self.assertIn('positive>=(lighting<42?5:4)',code)
        self.assertIn('&&changedRatio<0.46',code)
        self.assertIn('&&Math.abs(shift)<(dim?18:26)',code)
        self.assertIn('sustainedEvidence>=3',code)
        self.assertIn('return false;',code)
        self.assertIn('insideGarden((gx+.5f)/W,(gy+.5f)/H)',code)
        self.assertIn('changedRatio=nChange/(double)validCells',code)
        self.assertIn('"near".equals(value)',code)

    def test_clip_budget_not_expanded_or_priority_bypassed(self):
        rate=(SRC/'RecordingRate.java').read_text()
        self.assertIn('BASE_PER_HOUR=16',rate)
        self.assertIn('PRIORITY_RESERVE_PER_HOUR=8',rate)
        self.assertIn('TOTAL_PER_HOUR=BASE_PER_HOUR+PRIORITY_RESERVE_PER_HOUR',rate)
        self.assertIn('recorded<TOTAL_PER_HOUR && sustainedCoherent',rate)
        camera=(SRC/'CameraService.java').read_text()
        for condition in ('COOLDOWN_MS=12000','temperature()<415','folder.getUsableSpace()>15L*1024*1024*1024',
                          'saveFallbackEvidence("recording_budget_rejected")'):
            self.assertIn(condition,camera)

if __name__=="__main__":
    unittest.main(verbosity=2)
