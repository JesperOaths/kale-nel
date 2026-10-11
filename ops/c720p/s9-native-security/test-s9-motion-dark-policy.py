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

    def test_no_postclip_quota_with_thermal_and_storage_guards(self):
        camera=(SRC/'CameraService.java').read_text()
        for required in ('COOLDOWN_MS=0','MAX_4K_CLIPS_PER_HOUR=-1',
                         'temperature()<415','folder.getUsableSpace()>15L*1024*1024*1024',
                         'recording_hourly_quota_enabled",false',
                         'captureTier="unrestricted"'):
            self.assertIn(required,camera)
        self.assertNotIn('if(!rateAllowed(',camera)
        self.assertNotIn('recording_budget_rejected',camera)
        self.assertIn('noise[i]*3.4f',(SRC/'MotionGrid.java').read_text())
        self.assertIn('java.util.Arrays.sort(offsets,0,validCells)',(SRC/'MotionGrid.java').read_text())

if __name__=="__main__":
    unittest.main(verbosity=2)
