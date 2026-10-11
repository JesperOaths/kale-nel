#!/usr/bin/env python3
"""Bounded source-contract test: owner's drawn area applied to motion AND live person gate."""
import re
import unittest
from pathlib import Path
BASE=Path(__file__).resolve().parent/"src/nl/kalenel/s9security"
M=(BASE/"MotionGrid.java").read_text()
C=(BASE/"CameraService.java").read_text()
P=(BASE/"ClipClassifier.java").read_text()

def knots(key):
    m=re.search(r"private static final float\[\] "+key+r"=\{([^}]+)\}",M)
    assert m,key
    return [float(x.strip().rstrip("f")) for x in m.group(1).split(",")]

def at(x):
    a,b=knots("MARKED_X"),knots("MARKED_Y")
    for i in range(1,len(a)):
        if x<=a[i]:
            return b[i-1]+(x-a[i-1])/(a[i]-a[i-1])*(b[i]-b[i-1])
    return b[-1]

class MarkedGardenTest(unittest.TestCase):
    def test_owner_boundary_and_edges(self):
        xs,ys=knots("MARKED_X"),knots("MARKED_Y")
        self.assertEqual((xs[0],xs[-1]),(0,1))
        self.assertEqual(len(xs),6)
        self.assertEqual(len(xs),len(ys))
        self.assertTrue(all(xs[i]<xs[i+1] for i in range(len(xs)-1)))
        for x,y in [(0,.519),(.17,.519),(.36,.497),(.52,.484),(.67,.441),(1,.433)]:
            self.assertAlmostEqual(at(x),y,places=5)
        self.assertFalse(.30>=at(0.30)) # building and sky ignored
        self.assertTrue(.75>=at(.3)) # foreground garden monitored
        self.assertTrue(.5>=at(.9)) # new upper-right garden included

    def test_motion_grid_uses_polygon(self):
        self.assertIn('return insideZone(gardenZone,x,y);',M)
        self.assertIn('if("near".equals(zone))return y>=markedTopAt(x);',M)
        self.assertIn('NEAR_ROI_VERSION="owner_drawn_sloped_garden_v6"',M)
        self.assertIn('"near".equals(gardenZone)?0.433f:',M)
        self.assertIn('insideGarden((gx+.5f)/W,(gy+.5f)/H)',M)
        self.assertIn('if(t-lastSample<190)return false;',M)
        self.assertIn('votes.size()>7',M)
        self.assertIn('Math.abs(shift)<(dim?18:26)',M)
    def test_person_gpu_uses_exact_same_polygon(self):
        self.assertIn('MotionGrid.insideZone(zone,center,feet)',P)
        self.assertIn('personScoreInGarden(byte[] jpeg,float top,float margin,String zone)',P)
        self.assertIn('final String selectedZone=motion.gardenZone();',C)
        self.assertIn('personScoreInGarden(jpg,top,margin,selectedZone);',C)
        self.assertIn('garden_roi_gates_person_inference",true',C)
        self.assertIn('garden_roi_top_left_fraction',C)
        self.assertIn('garden_roi_top_right_fraction',C)
    def test_existing_recording_safety(self):
        for t in ('recorder.setVideoSize(3840,2160);',
                  'recorder.setVideoFrameRate(30);',
                  'gardenPersonGatePositiveStreak<2',
                  'garden_person_candidate_window_ms',
                  'folder.getUsableSpace()>15L*1024*1024*1024'):
            self.assertIn(t,C)
        self.assertIn('realtime_person_detector_failed',C)

if __name__=="__main__":
    unittest.main(verbosity=2)
