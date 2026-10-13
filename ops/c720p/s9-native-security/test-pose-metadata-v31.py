"""The public hub only receives bounded, camera-projected summaries."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('catalog',Path(__file__).parent.parent/'s9-person-ml-v1/local-sd-catalog.py')
catalog=importlib.util.module_from_spec(spec);spec.loader.exec_module(catalog)

def pose():
 return dict(version='projected_pose_motion_v1',scope='this_recording_only',identity_eligible=False,
  posture_availability='available',gait_availability='available_projected_ankle_cycle',
  posture='projected_upright',projected_direction='image_right',samples=32,torso_samples=32,
  full_body_samples=32,dense_samples=32,first_ms=1000,last_ms=4100,dense_span_ms=3100,
  mean_confidence=.9,apparent_speed_body_heights_per_second=.4,cadence_steps_per_minute=120,
  landmarks=[[.1,.2,.9]]*17,embedding=[.4]*128)

class PoseMetadataTests(unittest.TestCase):
 def test_actual_phone_schema_exports_measurements_and_drops_raw_features(self):
  clean=catalog.safe_pose_summary(pose(),10000)
  self.assertEqual(clean['posture'],'projected_upright')
  self.assertEqual(clean['cadence_steps_per_minute'],120)
  self.assertNotIn('landmarks',clean);self.assertNotIn('embedding',clean)
 def test_sparse_or_invalid_measurements_never_become_gait(self):
  raw=pose();raw['dense_samples']=12
  self.assertIsNone(catalog.safe_pose_summary(raw,10000)['cadence_steps_per_minute'])
  raw=pose();raw['cadence_steps_per_minute']=float('inf')
  self.assertIsNone(catalog.safe_pose_summary(raw,10000)['cadence_steps_per_minute'])
  raw=pose();raw['identity_eligible']=True
  self.assertIsNone(catalog.safe_pose_summary(raw,10000))
 def test_bad_scope_times_and_unknown_status_are_rejected(self):
  for key,value in [('scope','all_recordings'),('last_ms',120000),('gait_availability','invented'),('samples',True)]:
   raw=pose();raw[key]=value;self.assertIsNone(catalog.safe_pose_summary(raw,10000))

if __name__=='__main__':unittest.main(verbosity=2)
