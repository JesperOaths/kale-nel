"""Synthetic source windows: no ambiguous or duplicate frames become gait."""
import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('refiner',Path(__file__).with_name('refine-verified-motion-v33.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FakeModel:
 def pose_points(self,image):return m.np.zeros((17,3))
 def detect(self,image):raise AssertionError('ambiguous clip must not be decoded')
class Tests(unittest.TestCase):
 def track(self):return {'id':'one','first_s':0.,'last_s':6.,'trajectory':[[i,[10,0,50,90]] for i in range(7)]}
 def test_repeated_full_frames_do_not_become_independent_pose_samples(self):
  frame=m.np.zeros((100,100,3),m.np.uint8);track=self.track()
  with patch.object(m.w,'frames',return_value=iter([(i/8,frame) for i in range(48)])):
   observed,reason=m.sequence('synthetic',track,[track],FakeModel(),100,100)
  self.assertEqual(len(observed),1);self.assertIsNone(reason);self.assertIsNone(m.w.motion_summary(observed,.5)['cadence_spm'])
 def test_ambiguous_person_association_stops_before_decoding(self):
  track=self.track();track['trajectory']=[];other={**track,'id':'two'}
  with patch.object(m.w,'frames',side_effect=AssertionError('must not decode')):observed,reason=m.sequence('synthetic',track,[track,other],FakeModel(),100,100)
  self.assertEqual(observed,[]);self.assertEqual(reason,'multiple_people_track_association_unclear')
 def test_short_appearance_is_not_extended_outside_its_evidence(self):
  track=self.track();track['last_s']=2.
  with patch.object(m.w,'frames',side_effect=AssertionError('must not decode')):observed,reason=m.sequence('synthetic',track,[track],FakeModel(),100,100)
  self.assertEqual(reason,'appearance_too_short');self.assertEqual(observed,[])
 def test_review_window_stays_within_the_recorded_appearance(self):
  track=self.track();track.update(first_s=17.,last_s=29.);track['trajectory']=[];start,end=m.window(track)
  self.assertGreaterEqual(start,17);self.assertLessEqual(end,29);self.assertLessEqual(end-start,6)
if __name__=='__main__':unittest.main(verbosity=2)
