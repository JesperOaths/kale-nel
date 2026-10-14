"""No correlated or out-of-recording face probes count as independent support."""
import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('independent_faces',Path(__file__).with_name('refine-independent-faces-v35.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_probes_are_independent_of_anchor_and_each_other(self):
  tracks=[{'face_captures':[{'time_s':5,'comparable':True}]}];times=m.sample_times(tracks,10);self.assertGreaterEqual(len(times),4)
  self.assertTrue(all(abs(t-5)>=.75 for t in times));self.assertTrue(all(abs(a-b)>=.75 for i,a in enumerate(times) for b in times[i+1:]))
 def test_unusable_faces_do_not_trigger_identity_probe_downloads(self):self.assertEqual(m.sample_times([{'face_captures':[{'time_s':5,'comparable':False}]}],10),[])
 def test_plan_is_bounded_and_inside_the_original(self):
  times=m.sample_times([{'face_captures':[{'time_s':i,'comparable':True} for i in range(20)]}],20);self.assertLessEqual(len(times),12);self.assertTrue(all(.05<=t<19.95 for t in times))
if __name__=='__main__':unittest.main(verbosity=2)
