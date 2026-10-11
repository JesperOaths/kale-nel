#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('scorer',HERE/'score-shadow-results.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sample={'shadow_engine':'garden-shadow-v2-20261011',
 'ssd':{'p50_ms':48,'p90_ms':77},'efficientdet':{'p50_ms':89,'p90_ms':143},
 'clip_summary':[
  {'clip':'motion_1791600000000.mp4','paired_comparisons':12,'temporal_disagreement_frames':2,
   'ssd_confirmed_track_events':1,'lite0_confirmed_track_events':1,
   'adaptive_motion_frames':5,'exposure_flash_suppressions':1},
  {'clip':'motion_1791600100000.mp4','paired_comparisons':10,'temporal_disagreement_frames':1,
   'ssd_confirmed_track_events':1,'lite0_confirmed_track_events':0,
   'adaptive_motion_frames':4,'exposure_flash_suppressions':0},
  {'clip':'motion_1791600200000.mp4','paired_comparisons':11,'temporal_disagreement_frames':0,
   'ssd_confirmed_track_events':0,'lite0_confirmed_track_events':0,
   'adaptive_motion_frames':0,'exposure_flash_suppressions':2}]}
class TestScoring(unittest.TestCase):
 def test_no_fake_precision_without_labels(self):
  r=m.score(sample)
  self.assertEqual(r['clips_compared'],3)
  self.assertEqual(r['paired_frames'],33)
  self.assertEqual(r['paired_track_disagreements'],3)
  self.assertIsNone(r['unlabeled_accuracy'])
  self.assertFalse(r['model_accuracy_verified'])
  self.assertNotIn('precision',r)
 def test_descriptive_labeled_subset(self):
  names=[r['clip'] for r in sample['clip_summary']]
  r=m.score(sample,{names[0]:(True,'day'),names[1]:(False,'night'),names[2]:(True,'day')})
  self.assertEqual(r['ssd_on_labeled_subset']['tp'],1)
  self.assertEqual(r['ssd_on_labeled_subset']['fp'],1)
  self.assertEqual(r['ssd_on_labeled_subset']['fn'],1)
  self.assertEqual(r['lite0_on_labeled_subset']['fp'],0)
  self.assertEqual(r['lite0_on_labeled_subset']['tp'],1)
  self.assertFalse(r['model_accuracy_verified'])
 def test_rejects_forged_labels(self):
  with self.assertRaises(ValueError):m.score(sample,{'motion_1234567890123.mp4':(True,'day')})
  bad=dict(sample);bad['shadow_engine']='unknown'
  with self.assertRaises(ValueError):m.score(bad)
if __name__=='__main__':unittest.main(verbosity=2)
