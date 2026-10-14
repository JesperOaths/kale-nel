"""Synthetic dense pose sequences; no video or private descriptors."""
import importlib.util,math,sys,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('verified-people-worker-v33.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
import numpy as np
worker.np=np
class Tests(unittest.TestCase):
 def sequence(self,step=.125):return [(i*step,{'full_legs':True,'ankle_signal':.08*math.sin(2*math.pi*i/8)}) for i in range(48)]
 def test_repeated_cycles_choose_fundamental_not_slow_harmonic(self):
  result=worker.gait_metrics(self.sequence(),.5);self.assertEqual(result['cadence_spm'],120);self.assertGreaterEqual(result['gait_cycle_support'],.65)
 def test_sparse_frames_never_report_cadence(self):self.assertIsNone(worker.gait_metrics(self.sequence(.5),.5)['cadence_spm'])
 def test_stationary_and_hidden_legs_are_unknown(self):
  self.assertIsNone(worker.gait_metrics(self.sequence(),0)['cadence_spm']);self.assertIsNone(worker.gait_metrics([(t,{}) for t,_ in self.sequence()],.5)['cadence_spm'])
 def test_flat_signal_and_short_sequence_are_unknown(self):
  self.assertIsNone(worker.gait_metrics([(t,{'full_legs':True,'ankle_signal':.1}) for t,_ in self.sequence()],.5)['cadence_spm']);self.assertIsNone(worker.gait_metrics(self.sequence()[:15],.5)['cadence_spm'])
 def test_weak_keypoints_do_not_create_posture(self):self.assertEqual(worker.point_metrics(np.zeros((17,3))),{})
 def test_projected_pose_geometry_keeps_equal_coordinate_units(self):
  points=np.zeros((17,3));points[:,2]=.9;points[5,:2]=[.25,.2];points[6,:2]=[.25,.4];points[11,:2]=[.55,.22];points[12,:2]=[.55,.38]
  result=worker.point_metrics(points);self.assertEqual(result['posture'],'upright');self.assertAlmostEqual(result['torso_lean_degrees'],0)
 def test_trajectory_overlap_uses_actual_person_regions(self):
  self.assertEqual(worker.overlap([0,0,10,10],[20,20,30,30]),0);self.assertAlmostEqual(worker.overlap([0,0,10,10],[0,0,10,10]),1)
 def test_side_view_horizontal_ankles_can_measure_a_cycle(self):
  sequence=[(i*.125,{'full_legs':True,'ankle_signal':0,'ankle_y':0,'ankle_x':.08*math.sin(2*math.pi*i/8)}) for i in range(48)]
  self.assertEqual(worker.gait_metrics(sequence,.5)['cadence_spm'],120)
 def test_short_pose_gaps_do_not_erase_a_clear_dense_cycle(self):
  sequence=[p for i,p in enumerate(self.sequence()) if i not in (6,17,29)]
  self.assertEqual(worker.gait_metrics(sequence,.5)['cadence_spm'],120)
if __name__=='__main__':unittest.main(verbosity=2)
