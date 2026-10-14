"""Native head crops must refer to the exact stored detection frame."""
import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('dense_heads',Path(__file__).with_name('refine-dense-headfaces-v35.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def track(self):return {'frame_size':[100,50],'trajectory':[[0,[10,5,30,45]],[1,[20,5,40,45]]]}
 def test_exact_observed_box_scales_to_native_pixels(self):self.assertEqual(m.observed_box(self.track(),1,200,100),[40,10,80,90])
 def test_interpolated_frame_has_no_identity_assignment(self):self.assertIsNone(m.observed_box(self.track(),.5,200,100))
 def test_rounding_tolerance_is_bounded(self):self.assertIsNotNone(m.observed_box(self.track(),1.001,200,100));self.assertIsNone(m.observed_box(self.track(),1.04,200,100))
 def test_older_missing_trajectory_is_not_invented(self):self.assertIsNone(m.observed_box({'frame_size':[100,50]},1,200,100))
if __name__=='__main__':unittest.main(verbosity=2)
