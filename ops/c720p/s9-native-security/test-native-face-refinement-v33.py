"""Synthetic original-resolution association and independent-template guards."""
import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('native_faces',Path(__file__).with_name('refine-native-faces-v33.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def track(self,index,box):return {'id':str(index),'first_s':0,'last_s':10,'frame_size':[100,100],'trajectory':[[0,box],[10,box]],'face_captures':[]}
 def test_original_pixel_boxes_match_scaled_trajectories(self):
  a,b=self.track(1,[10,0,30,80]),self.track(2,[70,0,90,80]);self.assertIs(m.associate(5,[20,0,60,160],[a,b],200,200),a)
 def test_ambiguous_overlapping_candidates_are_not_assigned(self):
  a,b=self.track(1,[10,0,30,80]),self.track(2,[10,0,30,80]);self.assertIsNone(m.associate(5,[20,0,60,160],[a,b],200,200))
 def test_sample_plan_is_bounded_and_stays_inside_original(self):
  a=self.track(1,[10,0,30,80]);a['face_captures']=[{'time_s':i,'comparable':True} for i in range(20)];times=m.sample_times([a],10);self.assertLessEqual(len(times),6);self.assertTrue(all(0<=t<10 for t in times))
 def test_duplicate_times_and_conflicting_templates_do_not_inflate_support(self):
  candidates=[{'time_s':0,'quality':10,'vector':[1,0]},{'time_s':.2,'quality':9,'vector':[1,0]},{'time_s':2,'quality':8,'vector':[0,1]}];result=m.choose(candidates)
  self.assertEqual(len(result),2);self.assertEqual(sum(c['vector'] is not None for c in result),1)
if __name__=='__main__':unittest.main(verbosity=2)
