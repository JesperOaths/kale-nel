#!/usr/bin/env python3
"""No-device validation: Stage4 audit must never mutate Camera2, APKs or SD movies."""
import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).resolve().parent/"audit-stage4-readonly.py"
spec=importlib.util.spec_from_file_location("stage4",P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Stage4(unittest.TestCase):
 def test_clip_regex_strict(self):
  for n in ("motion_1791702363312.mp4","motion_1791600000000.mp4"):
   self.assertIsNotNone(m.CLIP.fullmatch(n))
  for bad in ("motion_1791702363312.mp4.recording","../motion_1791702363312.mp4",
              "motion_1791702363312.mp4;rm","motion_179170236331.mp4"):
   self.assertIsNone(m.CLIP.fullmatch(bad))
 def test_archive_sampling_is_bounded_and_stratified(self):
  clips=[f"motion_{1791000000000+i*1000}.mp4" for i in range(160)]
  output=m.choose(clips)
  self.assertLessEqual(len(output),42)
  self.assertEqual(len(output),len(set(output)))
  self.assertEqual(output[-1],clips[-1])
  self.assertEqual(output[0],clips[0])
  self.assertTrue(any(x in output for x in clips[30:90]))
 def test_no_side_effect_device_commands(self):
  s=P.read_text()
  for banned in ('adb("install"','adb("shell","rm"','adb("shell","mv"',
                 'force-stop','am","start','MediaRecorder','unlink(','.delete(',
                 'os.system(', 'shell=True', 'model_retired":True',
                 'retired_existing_detector":True'):
   self.assertNotIn(banned,s)
  self.assertIn('"decision":"HOLD_EXISTING_SSD_DETECTOR"',s)
  self.assertIn('"old_detector_retirement_authorized":False',s)
  self.assertIn('camera_live_frame_delta',s)
  self.assertIn('original_mp4s',s)
  self.assertIn('verified_sidecars_total',s)
 def test_timestamp_of_rollout(self):
  self.assertEqual(m.ROLLOUT_MS,1791702363000)
if __name__=='__main__':unittest.main(verbosity=2)
